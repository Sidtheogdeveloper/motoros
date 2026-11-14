from contextlib import asynccontextmanager
from threading import Event, Thread

import logging
import re
import os
import secrets
from datetime import UTC, datetime
from time import monotonic
from uuid import UUID, uuid4

import httpx
from fastapi import FastAPI, Header, Request, Response
from fastapi.responses import JSONResponse
from opentelemetry import metrics, trace
from opentelemetry.propagate import inject
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError

from .analytics import register as register_analytics
from .communications import register as register_communications
from .copilot import register as register_copilot
from .contracts import Feedback, Summary, SummaryList
from .events import bootstrap_local, poll
from .estimates import register as register_estimates
from .providers import ProviderFailure, configured_provider
from .storage import Store
from .vehicle_history import DomainError, PROMPT_VERSION, SYSTEM, Selection, snapshot, validate_selection

FEATURE = "vehicle_history"
logger = logging.getLogger("motoros.intelligence")
tracer = trace.get_tracer("motoros.intelligence")
meter = metrics.get_meter("motoros.intelligence")
requests = meter.create_counter("motoros.ai.requests")
failures = meter.create_counter("motoros.ai.errors")
latency = meter.create_histogram("motoros.ai.latency", unit="ms")
retrieval_latency = meter.create_histogram("motoros.ai.retrieval.latency", unit="ms")
model_latency = meter.create_histogram("motoros.ai.model.latency", unit="ms")
tokens = meter.create_counter("motoros.ai.tokens")
cache_hits = meter.create_counter("motoros.ai.cache.hits")


def create_app(*, store=None, provider=None, transport=None, service_key=None):
    customer_url = os.getenv("AI_CUSTOMER_URL", "http://127.0.0.1:8082")
    tenant_url = os.getenv("AI_TENANT_URL", "http://127.0.0.1:8081")
    database = os.getenv("AI_DATABASE_URL")
    if store is None and database:
        store = Store(create_engine(database, pool_pre_ping=True, pool_size=3, max_overflow=1),
                      int(os.getenv("AI_RETENTION_HOURS", "24")))
    if provider is None:
        provider = configured_provider()
    key = service_key if service_key is not None else os.getenv("AI_BFF_KEY", "")
    limit = max(1, min(int(os.getenv("AI_MONTHLY_SUMMARIES", "100")), 10000))

    @asynccontextmanager
    async def lifespan(_):
        queue = os.getenv("AI_HISTORY_QUEUE_URL")
        topics = {"customer": os.getenv("AI_CUSTOMER_TOPIC_ARN"),
                  "workorder": os.getenv("AI_WORKORDER_TOPIC_ARN")}
        endpoint = os.getenv("AI_SQS_ENDPOINT")
        if os.getenv("AI_HISTORY_LOCAL_EVENTS") == "true":
            queue, topics = bootstrap_local(endpoint)
        stop = Event()
        worker = None
        if queue:
            if not store or not all(topics.values()):
                raise RuntimeError("History events require a database and both trusted topic ARNs.")
            worker = Thread(target=poll, args=(store, stop, queue, topics,
                            endpoint), daemon=True)
            worker.start()
        try:
            yield
        finally:
            stop.set()
            if worker:
                worker.join(timeout=10)

    app = FastAPI(title="MotorOS Intelligence", docs_url=None, redoc_url=None, openapi_url=None,
                  lifespan=lifespan)

    @app.exception_handler(DomainError)
    async def domain_failure(_: Request, error: DomainError):
        failures.add(1, {"feature": FEATURE, "status": error.status})
        return JSONResponse({"title": error.title}, status_code=error.status,
                            headers={"Cache-Control": "no-store"})

    @app.exception_handler(SQLAlchemyError)
    async def database_failure(_: Request, __: SQLAlchemyError):
        logger.warning("intelligence_store_unavailable")
        return JSONResponse({"title": "AI storage unavailable."}, status_code=503,
                            headers={"Cache-Control": "no-store"})

    @app.get("/healthz")
    def health():
        return {"status": "up"}

    @app.post("/api/ai/vehicles/{vehicle_id}/history-feedback", response_model=Feedback)
    @app.post("/api/ai/vehicles/{vehicle_id}/history-summary", response_model=Summary)
    @app.get("/api/ai/vehicles/{vehicle_id}/history-summaries", response_model=SummaryList)
    def history(
        request: Request, response: Response, vehicle_id: UUID, branchId: UUID,
        authorization: str = Header(default=""),
        x_motoros_tenant: str = Header(default=""),
        x_motoros_ai_key: str = Header(default=""),
        x_motoros_actor: str = Header(default=""), summaryId: str | None = None,
        helpful: bool | None = None,
    ):
        started = monotonic()
        requests.add(1, {"feature": FEATURE})
        request_id = str(uuid4())
        if len(key) < 32 or not secrets.compare_digest(key.encode(), x_motoros_ai_key.encode()):
            raise DomainError(403, "AI gateway authorization required.")
        if not authorization.startswith("Bearer ") or len(authorization) > 8192:
            raise DomainError(401, "A valid session is required.")
        try:
            tenant = str(UUID(x_motoros_tenant))
        except ValueError as error:
            raise DomainError(403, "An active workshop is required.") from error

        # Forward the original signed token. A successful read means the owning API verified the
        # bearer, current tenant membership, permission and vehicle/branch scope.
        headers = {"Authorization": authorization, "X-MotorOS-Tenant": tenant,
                   "X-Correlation-ID": request_id}
        actor = x_motoros_actor if re.fullmatch(r"[0-9a-f]{64}", x_motoros_actor) else None
        watermark = store.watermark(tenant, str(vehicle_id)) if store else None
        retrieved_at = monotonic()
        with tracer.start_as_current_span("vehicle_history.retrieve"):
            inject(headers)
            with httpx.Client(transport=transport, trust_env=False) as client:
                current = snapshot(client, customer_url, tenant_url, headers, vehicle_id, branchId)
        retrieval_latency.record((monotonic() - retrieved_at) * 1000, {"feature": FEATURE})

        response.headers["Cache-Control"] = "no-store"
        identifier = provider.identifier if provider else "disabled"
        cache_key = current.key(tenant, str(branchId), str(vehicle_id), identifier, watermark)
        if request.url.path.endswith("/history-feedback"):
            if actor is None or helpful is None or summaryId is None:
                raise DomainError(400, "A valid summary and feedback choice are required.")
            if (summaryId != cache_key or not store or not store.cached(tenant, cache_key)
                    or store.watermark(tenant, str(vehicle_id)) != watermark):
                raise DomainError(409, "This summary has changed. Refresh before leaving feedback.")
            store.vote(cache_key, actor, helpful)
            return {"helpful": helpful}
        usage = {"inputTokens": 0, "outputTokens": 0, "cacheHit": False}
        generated = datetime.now(UTC)
        selected = []

        if current.evidence:
            if not provider or not store:
                raise DomainError(503, "AI provider unavailable. The service timeline is still accessible.")
            cached = store.cached(tenant, cache_key)
            if cached:
                selected = validate_selection(cached.selection, current.evidence)
                generated = cached.created_at
                if generated.tzinfo is None:
                    generated = generated.replace(tzinfo=UTC)
                usage["cacheHit"] = True
                cache_hits.add(1, {"feature": FEATURE})
            elif request.method == "GET":
                return {"summaries": []}
            else:
                period = store.reserve(tenant, FEATURE, limit)
                if not period:
                    raise DomainError(429, "This workshop has reached its monthly AI request limit.")
                model_evidence = [
                    {field: item[field] for field in ("id", "category", "text")}
                    for item in current.evidence
                ]
                try:
                    inference_started = monotonic()
                    with tracer.start_as_current_span("vehicle_history.select_evidence"):
                        result = provider.generate(SYSTEM, {"evidence": model_evidence},
                                                   Selection.model_json_schema())
                    model_latency.record((monotonic() - inference_started) * 1000, {"feature": FEATURE})
                except ProviderFailure as error:
                    logger.warning("intelligence_provider_failure request_id=%s feature=%s", request_id, FEATURE)
                    raise DomainError(503, "AI provider unavailable. Retry later.") from error
                store.record(tenant, FEATURE, period, result)
                tokens.add(result.input_tokens, {"feature": FEATURE, "direction": "input"})
                tokens.add(result.output_tokens, {"feature": FEATURE, "direction": "output"})
                usage.update(inputTokens=result.input_tokens, outputTokens=result.output_tokens)
                if len(result.text) > 8192:
                    raise DomainError(502, "The model returned an oversized history selection.")
                selected = validate_selection(result.text, current.evidence)
                latest = store.watermark(tenant, str(vehicle_id))
                if latest != watermark:
                    # A delayed event may describe the same records already read. Recheck the
                    # authorized snapshot before deciding whether the model result is still valid.
                    with httpx.Client(transport=transport, trust_env=False) as client:
                        refreshed = snapshot(client, customer_url, tenant_url, headers, vehicle_id,
                                             branchId, budget=5)
                    if refreshed != current:
                        raise DomainError(409, "Vehicle history changed. Refresh the summary.")
                    watermark = latest
                    cache_key = current.key(tenant, str(branchId), str(vehicle_id), identifier, watermark)
                generated = store.save(tenant, str(vehicle_id), cache_key, result.text)
        elif request.method == "GET":
            return {"summaries": []}
        else:
            identifier = "none"

        if store and store.watermark(tenant, str(vehicle_id)) != watermark:
            if request.method == "GET":
                return {"summaries": []}
            raise DomainError(409, "Vehicle history changed. Refresh the summary.")
        summary_id = cache_key if identifier != "none" else None
        vote = store.feedback(summary_id, actor) if store and summary_id and actor else None
        by_id = {item["id"]: item for item in current.evidence}
        summary = {
            "requestId": request_id, "summaryId": summary_id, "helpful": vote, "feature": FEATURE, "tenantContext": {"branchId": str(branchId)},
            "modelIdentifier": identifier, "generatedAt": generated,
            "response": {"vehicleOverview": current.overview, "recordedVisits": len(current.visits),
                         "highlights": [by_id[number] for number in selected],
                         "repeatedComplaints": current.repeated_complaints()},
            "sourceReferences": current.visits,
            "warnings": current.warnings + [
                "Recorded recommendations may have been resolved later. A qualified technician must verify current condition."
            ],
            "reviewRequired": True, "usageMetadata": usage,
            "promptVersion": PROMPT_VERSION,
        }
        latency.record((monotonic() - started) * 1000, {"feature": FEATURE})
        logger.info("intelligence_history request_id=%s latency_ms=%d cache_hit=%s",
                    request_id, int((monotonic() - started) * 1000), usage["cacheHit"])
        return {"summaries": [summary]} if request.method == "GET" else summary

    register_copilot(app, store, provider, transport, key, customer_url, tenant_url)
    register_estimates(app, store, provider, transport, key, customer_url, tenant_url)
    register_analytics(app, store, provider, transport, key, tenant_url)
    register_communications(app, store, provider, transport, key, tenant_url)
    return app


app = create_app()
