"""Evidence-bound estimate suggestions. Only Billing can write or price an estimate."""
import json
import logging
import os
import re
import secrets
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from time import monotonic
from uuid import UUID, uuid4

import httpx
from fastapi import Depends, Header, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import JSON, Column, DateTime, MetaData, String, Table, delete, select

from .copilot import terms
from .providers import ProviderFailure
from .vehicle_history import DomainError, get_json, snapshot

FEATURE = "repair_estimate"
LOG = logging.getLogger("motoros.intelligence")
SYSTEM = (
    "Rank only the numbered catalog candidates using the provided match signals. "
    "Favor exact requests and corroborated inspection matches. Return candidate numbers only. "
    "Do not propose parts, prices, quantities, discounts, taxes, diagnoses or authorizations."
)
metadata = MetaData()
drafts = Table(
    "ai_estimate_drafts", metadata,
    Column("tenant", String(36), primary_key=True),
    Column("actor", String(64), primary_key=True),
    Column("id", String(36), primary_key=True),
    Column("job", String(36), nullable=False),
    Column("body", JSON, nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False, index=True),
)


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")
    workOrderId: UUID
    requestId: UUID


class Choice(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ids: list[int] = Field(max_length=12)


class Line(BaseModel):
    model_config = ConfigDict(extra="forbid")
    partId: UUID | None = None
    description: str = Field(min_length=1, max_length=500)
    quantity: Decimal = Field(ge=Decimal("0.001"), le=10000, max_digits=8, decimal_places=3)


class Apply(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[Line] = Field(min_length=1, max_length=20)
    note: str = Field(default="", max_length=2000)
    estimateId: UUID | None = None
    version: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_target(self):
        if (self.estimateId is None) != (self.version is None):
            raise ValueError("An existing estimate and version are required together.")
        return self


def choose(store, tenant, provider, candidates):
    signals = [{"number": n, "exactRequest": c["exact"], "matchedWords": c["score"],
                "availableAtBranch": bool(Decimal(c["available"] or "0") > 0)}
               for n, c in enumerate(candidates, 1)]
    period = store.reserve(tenant, FEATURE, 100) if provider and signals else None
    if period:
        try:
            result = provider.generate(SYSTEM, {"candidates": signals}, Choice.model_json_schema())
            choice = Choice.model_validate_json(result.text, strict=True).ids
            if len(set(choice)) != len(choice) or not all(1 <= i <= len(signals) for i in choice):
                raise ValueError("Invalid selection")
            store.record(tenant, FEATURE, period, result)
            return [candidates[i - 1] for i in choice], "model_ranked"
        except (ProviderFailure, ValidationError, ValueError):
            LOG.info("estimate_model_selection_rejected")
    return candidates[:8], "evidence_only"


def candidates_for(parts, requests, findings, available):
    found = []
    for part in parts:
        name, sku = part.get("name", ""), part.get("sku", "")
        if not part.get("active") or not name or not part.get("id"):
            continue
        exact = next((p for p in requests if str(p.get("description", "")).casefold().strip()
                      in {name.casefold().strip(), sku.casefold().strip()}), None)
        words = set(terms(name))
        best = max(((len(words.intersection(terms(f["label"]))), f) for f in findings),
                   key=lambda pair: pair[0], default=(0, None))
        if not exact and (best[0] < 2 or best[0] != len(words)):
            continue
        found.append({
            "partId": part["id"], "description": name[:300], "sku": sku, "exact": bool(exact),
            "score": best[0], "quantity": str(exact["quantity"]) if exact else None,
            "available": available.get(part["id"]), "catalogVersion": part.get("version"),
            "source": ({"kind": "partRequest", "id": exact["id"], "label": "Recorded part request"}
                       if exact else best[1]),
        })
    return sorted(found, key=lambda c: (-int(c["exact"]), -c["score"], c["partId"]))[:12]


def register(app, store, provider, transport, key, customer_url, tenant_url):
    work = os.getenv("AI_WORKORDER_URL", "http://127.0.0.1:8083")
    inventory = os.getenv("AI_INVENTORY_URL", "http://127.0.0.1:8085")
    billing = os.getenv("AI_BILLING_URL", "http://127.0.0.1:8086")
    booking = os.getenv("AI_BOOKING_URL", "http://127.0.0.1:8084")

    def identity(response: Response, authorization: str = Header(default=""),
                 x_motoros_tenant: str = Header(default=""),
                 x_motoros_ai_key: str = Header(default=""),
                 x_motoros_actor: str = Header(default="")):
        response.headers["Cache-Control"] = "no-store"
        if len(key) < 32 or not secrets.compare_digest(key.encode(), x_motoros_ai_key.encode()):
            raise DomainError(403, "AI gateway authorization required.")
        if not authorization.startswith("Bearer ") or len(authorization) > 8192:
            raise DomainError(401, "A valid session is required.")
        try:
            tenant = str(UUID(x_motoros_tenant))
        except ValueError as error:
            raise DomainError(403, "An active workshop is required.") from error
        if not re.fullmatch(r"[0-9a-f]{64}", x_motoros_actor):
            raise DomainError(403, "Staff identity is required.")
        if store is None:
            raise DomainError(503, "Estimate assistance storage is unavailable.")
        return tenant, x_motoros_actor, {
            "Authorization": authorization, "X-MotorOS-Tenant": tenant,
            "X-Correlation-ID": str(uuid4()),
        }

    def read(client, base, path, context, deadline, params=None):
        try:
            return get_json(client, base, path, context[2], deadline, params)
        except DomainError as error:
            raise DomainError(error.status, "An estimate source is unavailable or access was denied.") from error

    def authorize(client, context, job_id, deadline):
        permission = read(client, tenant_url, "/api/me/permissions", context, deadline)
        granted = set(permission.get("permissions", []))
        if permission.get("tenantId") != context[0] or not {
            "ESTIMATE_READ", "ESTIMATE_CREATE", "INVENTORY_READ", "WORKORDER_READ",
        }.issubset(granted):
            raise DomainError(403, "This role cannot prepare estimates.")
        job = read(client, work, f"/api/work-orders/{job_id}", context, deadline)
        if job.get("id") != job_id or (not permission.get("tenantWide")
                                      and job.get("branchId") not in permission.get("branches", [])):
            raise DomainError(403, "Work order access denied.")
        return job, granted

    def where(context, draft_id):
        return ((drafts.c.tenant == context[0]) & (drafts.c.actor == context[1])
                & (drafts.c.id == draft_id))

    def load(context, draft_id):
        with store.engine.connect() as conn:
            return conn.execute(select(drafts.c.body).where(
                where(context, draft_id), drafts.c.expires_at > datetime.now(UTC),
            )).scalar_one_or_none()

    @app.post("/api/ai/estimates/draft")
    def generate(value: Input, context=Depends(identity)):
        job_id, draft_id = str(value.workOrderId), str(value.requestId)
        deadline = monotonic() + 24
        with httpx.Client(transport=transport, trust_env=False) as client:
            job, granted = authorize(client, context, job_id, deadline)
            existing = load(context, draft_id)
            if existing:
                if existing["workOrderId"] != job_id:
                    raise DomainError(409, "This draft request already refers to another work order.")
                return existing
            if job.get("status") in {"DELIVERED", "CLOSED", "CANCELLED"} or not job.get("customerId"):
                raise DomainError(409, "Use an open work order with a linked customer.")
            branch = job["branchId"]
            review, warnings, sources, inspections = [], [], [], []
            details = read(client, work, f"/api/work-orders/{job_id}/inspections", context, deadline)
            for inspection in details[-8:]:
                if inspection.get("status") == "COMPLETED":
                    for finding in inspection.get("findings", [])[:50]:
                        if finding.get("requiresAttention") and finding.get("condition") == "ATTENTION_REQUIRED":
                            inspections.append({"kind": "inspection", "id": inspection["id"],
                                                "label": str(finding["inspectionItem"])[:160]})
            requested = [p for p in job.get("parts", [])[:30] if p.get("status") != "CANCELLED"]
            sources.extend(inspections[:20])
            words = list(dict.fromkeys(
                [str(p.get("description", ""))[:120] for p in requested] +
                [word for f in inspections for word in terms(f["label"]) if len(word) > 3]
            ))[:8]
            prices = None
            try:
                prices = read(client, billing, "/api/billing/settings", context, deadline, {"branchId": branch})
            except DomainError as error:
                if error.status != 404:
                    raise
                warnings.append("Billing settings are missing for this branch. Configure them before saving.")
            catalog, stock = {}, {}
            for word in (word for word in words if word.strip()):
                page = read(client, inventory, "/api/parts", context, deadline, {"q": word, "size": 20})
                for part in page["content"]:
                    if not prices or part.get("currency") == prices["currency"]:
                        catalog[part["id"]] = part
            for candidate in candidates_for(list(catalog.values()), requested, inspections, {}):
                page = read(client, inventory, "/api/inventory/stock", context, deadline,
                            {"branchId": branch, "q": candidate["sku"], "size": 20})
                for row in page["content"]:
                    stock[row["partId"]] = str(row["available"])
            candidates = candidates_for(list(catalog.values()), requested, inspections, stock)
            matched = {c["source"]["id"] for c in candidates if c["exact"]}
            review += [str(p.get("description", ""))[:160] for p in requested if p["id"] not in matched]
            known_services = []
            if "BOOKING_READ" in granted:
                categories = read(client, booking, "/api/service-categories", context, deadline)
                finding_words = {w for f in inspections for w in terms(f["label"])}
                for category in categories:
                    name = category["name"]
                    tokens = set(terms(name))
                    if tokens and tokens.issubset(finding_words):
                        known_services.append({"id": category["id"], "name": name})
            if "VEHICLE_HISTORY_READ" in granted:
                try:
                    history = snapshot(client, customer_url, tenant_url, context[2], UUID(job["vehicleId"]),
                                       UUID(branch), budget=min(5, max(0, deadline - monotonic())))
                    sources += [{"kind": "history", "id": v["resourceId"], "label": f'{v["branch"]} · {v["date"][:10]}'}
                                for v in history.visits[:4]]
                except DomainError:
                    warnings.append("Prior service history was unavailable for this draft.")
            previous = read(client, billing, "/api/estimates", context, deadline,
                            {"branchId": branch, "workOrderId": job_id, "size": 10})
        selected, mode = choose(store, context[0], provider, candidates)
        now = datetime.now(UTC)
        proposal = {
            "estimateDraftId": draft_id, "workOrderId": job_id, "branchId": branch,
            "expiresAt": (now + timedelta(days=7)).isoformat(), "mode": mode,
            "suggestedItems": [{k: v for k, v in c.items() if k not in {"exact", "score"}} for c in selected],
            "catalogItemReferences": [c["partId"] for c in selected],
            "serviceDescriptions": known_services,
            "requiredReviewItems": review + ["Confirm scope, part fitment, quantities and labor hours."],
            "missingPricingInformation": (["Branch Billing settings"] if prices is None else []) +
                (["Service category prices need advisor review."] if known_services else []),
            "sourceReferences": [{"kind": "workOrder", "id": job_id, "label": "Current work order"}] + sources,
            "warnings": warnings + ["Stock is a snapshot, not a reservation. Billing verifies prices on save."],
            "existingEstimates": [{k: row[k] for k in ("id", "status", "revision", "version")}
                                  for row in previous["content"]],
            "explanation": ("Please review the recommended work and estimate before authorizing repairs. "
                            "Your advisor can explain the inspection findings and confirm the final scope."),
        }
        with store.engine.begin() as conn:
            conn.execute(delete(drafts).where(drafts.c.expires_at <= now))
            conn.execute(store.insert(drafts).values(
                tenant=context[0], actor=context[1], id=draft_id, job=job_id, body=proposal,
                expires_at=now + timedelta(hours=24),
            ).on_conflict_do_nothing(index_elements=["tenant", "actor", "id"]))
        result = load(context, draft_id)
        if not result or result["workOrderId"] != job_id:
            raise DomainError(409, "This draft request already refers to another work order.")
        return result

    @app.get("/api/ai/estimates/drafts/{draft_id}")
    def get(draft_id: UUID, context=Depends(identity)):
        proposal = load(context, str(draft_id))
        if not proposal:
            raise DomainError(404, "Draft unavailable or expired.")
        with httpx.Client(transport=transport, trust_env=False) as client:
            authorize(client, context, proposal["workOrderId"], monotonic() + 12)
        return proposal

    @app.post("/api/ai/estimates/drafts/{draft_id}/apply")
    def apply(draft_id: UUID, value: Apply, context=Depends(identity)):
        proposal = load(context, str(draft_id))
        if not proposal:
            raise DomainError(404, "Draft unavailable or expired.")
        job_id, branch = proposal["workOrderId"], proposal["branchId"]
        items = []
        for line in value.items:
            part = str(line.partId) if line.partId else None
            if part and part not in proposal["catalogItemReferences"]:
                raise DomainError(422, "Choose a suggested catalog part or add other items in Billing.")
            items.append({"itemType": "PART" if part else "LABOR", "partId": part,
                          "description": line.description, "quantity": format(line.quantity, "f"),
                          "unitPrice": "0", "discountPercent": "0"})
        target = str(value.estimateId) if value.estimateId else None
        with httpx.Client(transport=transport, trust_env=False) as client:
            deadline = monotonic() + 12
            job, _ = authorize(client, context, job_id, deadline)
            if job["branchId"] != branch:
                raise DomainError(409, "Work order branch changed. Generate a new draft.")
            if target:
                current = read(client, billing, f"/api/estimates/{target}", context, deadline)
                if current["workOrderId"] != job_id or current["branchId"] != branch:
                    raise DomainError(403, "Estimate does not belong to this work order.")
            headers = {**context[2], "Idempotency-Key": f"ai-{draft_id}"}
            try:
                result = client.request("PATCH" if target else "POST",
                    billing.rstrip("/") + "/api/estimates" + (f"/{target}" if target else ""),
                    headers=headers, timeout=httpx.Timeout(12, connect=2),
                    json={"branchId": branch, "workOrderId": job_id, "items": items,
                          "note": value.note, "expiresAt": proposal["expiresAt"], "version": value.version})
            except httpx.HTTPError as error:
                raise DomainError(503, "Billing is unavailable. Retry the same draft safely.") from error
            if result.status_code not in (200, 201):
                status = result.status_code if result.status_code in (400, 401, 403, 404, 409, 422) else 503
                raise DomainError(status, "Billing could not save the draft. Check pricing, work order and revision.")
            estimate = result.json()
            if estimate["workOrderId"] != job_id or estimate["branchId"] != branch:
                raise DomainError(503, "Billing returned an unexpected estimate.")
            return estimate
