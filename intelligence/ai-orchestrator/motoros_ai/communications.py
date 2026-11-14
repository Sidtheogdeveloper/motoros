"""Safe tone selection and forwarding to the Notification-owned approval workflow."""
import os
import re
import secrets
from time import monotonic
from typing import Literal
from uuid import UUID, uuid4

import httpx
from fastapi import Depends, Header, Query, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .providers import ProviderFailure
from .vehicle_history import DomainError, get_json

Tone = Literal["PROFESSIONAL", "FRIENDLY", "CONCISE"]
Language = Literal["en", "ta"]
Channel = Literal["EMAIL", "SMS", "WHATSAPP"]
Purpose = Literal[
    "APPOINTMENT_CONFIRMATION", "APPOINTMENT_REMINDER", "APPOINTMENT_RESCHEDULE",
    "VEHICLE_CHECKED_IN", "INSPECTION_COMPLETED", "ESTIMATE_APPROVAL", "ESTIMATE_EXPLANATION",
    "REPAIR_PROGRESS", "READY_FOR_COLLECTION", "INVOICE_AVAILABLE", "PAYMENT_CONFIRMATION",
    "SERVICE_FOLLOW_UP", "MAINTENANCE_REMINDER",
]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NewDraft(Strict):
    branchId: UUID
    customerId: UUID
    vehicleId: UUID
    resourceId: UUID
    purpose: Purpose
    channel: Channel
    language: Language
    tone: Tone | Literal["AUTO"] = "AUTO"
    includeDetails: bool = True


class Edit(Strict):
    version: int = Field(ge=0)
    language: Language
    tone: Tone
    includeDetails: bool


class Confirm(Strict):
    version: int = Field(ge=0)
    confirmed: Literal[True]


class SelectedTone(Strict):
    tone: Tone


def choose_tone(body, provider, store, tenant):
    if body.tone != "AUTO":
        return body.tone
    if provider and store:
        period = store.reserve(tenant, "customer_communications", 100)
        if period:
            try:
                result = provider.generate(
                    "Choose an appropriate communication tone. Return only the tone enum. "
                    "Use professional for financial or approval messages.",
                    {"purpose": body.purpose, "language": body.language, "channel": body.channel},
                    SelectedTone.model_json_schema(),
                )
                tone = SelectedTone.model_validate_json(result.text, strict=True).tone
                store.record(tenant, "customer_communications", period, result)
                return tone
            except (ProviderFailure, ValidationError):
                pass
    return "PROFESSIONAL"


def register(app, store, provider, transport, key, tenant_url):
    notification = os.getenv("AI_NOTIFICATION_URL", "http://127.0.0.1:8087").rstrip("/")
    prefix = "/api/ai/communications"
    upstream = notification + "/api/notifications/assistant"

    def identity(response: Response, authorization: str = Header(default=""),
                 x_motoros_tenant: str = Header(default=""), x_motoros_ai_key: str = Header(default=""),
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
        return {"Authorization": authorization, "X-MotorOS-Tenant": tenant,
                "X-Correlation-ID": str(uuid4())}

    def call(method, path, headers, body=None, params=None):
        try:
            with httpx.Client(transport=transport, trust_env=False) as client:
                response = client.request(method, upstream + path, headers=headers, json=body,
                                          params=params, timeout=httpx.Timeout(33, connect=2))
            if not response.is_success:
                status = response.status_code
                if status not in {400, 401, 403, 404, 409, 422}:
                    raise DomainError(503, "Notification Service is temporarily unavailable.")
                payload = response.json()
                title = payload.get("detail") or payload.get("message") or payload.get("title")
                raise DomainError(status, title or "Notification Service rejected this operation.")
            return response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise DomainError(503, "Notification Service is temporarily unavailable.") from error

    @app.post(prefix + "/draft")
    def create(body: NewDraft, headers=Depends(identity)):
        data = body.model_dump(mode="json")
        if body.tone == "AUTO" and provider and store:
            with httpx.Client(transport=transport, trust_env=False) as client:
                access = get_json(client, tenant_url, "/api/me/permissions", headers, monotonic() + 5)
            if (access.get("tenantId") != headers["X-MotorOS-Tenant"]
                    or not {"AI_COMMUNICATION_DRAFT_USE", "NOTIFICATION_MANAGE", "CUSTOMER_READ"}.issubset(
                        access.get("permissions", []))
                    or str(body.branchId) not in access.get("branches", [])):
                raise DomainError(403, "Communication draft access is denied.")
        data["tone"] = choose_tone(body, provider, store, headers["X-MotorOS-Tenant"])
        return call("POST", "/draft", headers, data)

    @app.get(prefix + "/drafts")
    def list_drafts(branchId: UUID, page: int = Query(0, ge=0, le=1000), headers=Depends(identity)):
        return call("GET", "/drafts", headers, params={"branchId": str(branchId), "page": page})

    @app.patch(prefix + "/drafts/{draft_id}")
    def edit(draft_id: UUID, body: Edit, headers=Depends(identity)):
        return call("PATCH", f"/drafts/{draft_id}", headers, body.model_dump())

    @app.post(prefix + "/drafts/{draft_id}/approve")
    def approve(draft_id: UUID, body: Confirm, headers=Depends(identity)):
        return call("POST", f"/drafts/{draft_id}/approve", headers, body.model_dump())

    @app.post(prefix + "/drafts/{draft_id}/send")
    def send(draft_id: UUID, body: Confirm, headers=Depends(identity)):
        return call("POST", f"/drafts/{draft_id}/send", headers, body.model_dump())
