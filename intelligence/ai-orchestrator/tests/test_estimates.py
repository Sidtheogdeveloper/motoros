import json
from uuid import UUID

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from motoros_ai.app import create_app
from motoros_ai.estimates import metadata as estimate_metadata
from motoros_ai.providers import Inference, ProviderFailure
from motoros_ai.storage import Store, metadata

IDS = [str(UUID(int=i)) for i in range(1, 12)]
TENANT, OTHER, JOB, BRANCH, VEHICLE, REQUEST, PART, UNSUPPORTED, INSPECTION, KEY_ID, BILL = IDS
KEY = "fixture-estimates-only-shared-auth-token"
BASE = "/api/ai/estimates"
GRANTED = ["ESTIMATE_READ", "ESTIMATE_CREATE", "INVENTORY_READ", "WORKORDER_READ"]


class OwnerApis:
    def __init__(self):
        self.permissions = GRANTED.copy()
        self.branch = BRANCH
        self.job = JOB
        self.mutations = []

    def __call__(self, request):
        path = request.url.path
        tenant = request.headers["X-MotorOS-Tenant"]
        if path == "/api/me/permissions":
            return httpx.Response(200, json={"tenantId": tenant, "permissions": self.permissions,
                                             "branches": [self.branch]})
        if path.startswith("/api/work-orders/") and tenant != TENANT:
            return httpx.Response(404)
        if path == f"/api/work-orders/{self.job}":
            return httpx.Response(200, json={"id": self.job, "branchId": BRANCH,
                "vehicleId": VEHICLE, "customerId": "PRIVATE-CUSTOMER", "status": "INSPECTION",
                "parts": [{"id": REQUEST, "description": "Brake pads", "quantity": "2", "status": "REQUESTED"}]})
        if path == f"/api/work-orders/{self.job}/inspections":
            return httpx.Response(200, json=[{"id": INSPECTION, "status": "COMPLETED", "findings": [
                {"condition": "ATTENTION_REQUIRED", "requiresAttention": True, "inspectionItem": "Brake pads"},
            ]}])
        if path == "/api/parts":
            return httpx.Response(200, json={"content": [
                {"id": PART, "active": True, "sku": "PAD1", "name": "Brake pads",
                 "sellingPrice": "125.00", "version": 1, "currency": "INR"},
                {"id": UNSUPPORTED, "active": False, "sku": "OLD", "name": "Brake pads", "currency": "INR"},
            ]})
        if path == "/api/inventory/stock":
            assert request.url.params["branchId"] == BRANCH
            return httpx.Response(200, json={"content": [{"partId": PART, "available": "3"}]})
        if path == "/api/billing/settings":
            return httpx.Response(200, json={"currency": "INR", "laborHourlyRate": "100"})
        if path.startswith("/api/estimates") and request.method != "GET":
            self.mutations.append((request.method, request.headers["Idempotency-Key"], json.loads(request.content)))
            return httpx.Response(200, json={"id": BILL, "branchId": BRANCH, "workOrderId": JOB,
                                             "status": "DRAFT", "total": "295.00"})
        if path == "/api/estimates":
            return httpx.Response(200, json={"content": []})
        if path == f"/api/estimates/{BILL}":
            return httpx.Response(200, json={"id": BILL, "branchId": BRANCH, "workOrderId": self.job})
        return httpx.Response(404)


class Provider:
    def __init__(self):
        self.output = '{"ids":[1]}'
        self.calls = []

    def generate(self, system, data, schema):
        self.calls.append(data)
        if self.output is None:
            raise ProviderFailure()
        return Inference(self.output)


def headers(tenant=TENANT, actor="a"):
    return {"X-MotorOS-Tenant": tenant, "X-MotorOS-Actor": actor * 64,
            "Authorization": "Bearer synthetic", "X-MotorOS-AI-Key": KEY}


@pytest.fixture
def stack():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    metadata.create_all(engine)
    estimate_metadata.create_all(engine)
    provider, domain = Provider(), OwnerApis()
    with TestClient(create_app(store=Store(engine), provider=provider, service_key=KEY,
                              transport=httpx.MockTransport(domain))) as client:
        yield client, provider, domain


def generate(client, **options):
    return client.post(BASE + "/draft", json={"workOrderId": JOB, "requestId": KEY_ID},
                       headers=headers(**options))


def test_scoped_draft_exposes_only_catalog_evidence_and_replays(stack):
    client, provider, _ = stack
    response = generate(client)
    assert response.status_code == 200, response.text
    draft = response.json()
    assert draft["catalogItemReferences"] == [PART]
    assert draft["suggestedItems"][0]["quantity"] == "2"
    assert draft["suggestedItems"][0]["available"] == "3"
    assert "125.00" not in response.text
    assert provider.calls == [{"candidates": [
        {"number": 1, "exactRequest": True, "matchedWords": 2, "availableAtBranch": True},
    ]}]
    assert generate(client).json() == draft
    assert len(provider.calls) == 1
    path = f"{BASE}/drafts/{KEY_ID}"
    assert client.get(path, headers=headers(actor="b")).status_code == 404
    assert client.get(path, headers=headers(tenant=OTHER)).status_code == 404
    assert generate(client, tenant=OTHER).status_code == 404


@pytest.mark.parametrize("invalid", ['{"ids":[999]}', '{"ids":[1,1]}', '{"ids":[true]}',
                                      '{"ids":[1],"unitPrice":1}', None])
def test_invalid_model_or_outage_uses_safe_evidence(stack, invalid):
    client, provider, _ = stack
    provider.output = invalid
    draft = generate(client).json()
    assert draft["mode"] == "evidence_only"
    assert draft["catalogItemReferences"] == [PART]


def test_apply_validates_catalog_and_leaves_pricing_to_billing(stack):
    client, _, domain = stack
    assert generate(client).status_code == 200
    path = f"{BASE}/drafts/{KEY_ID}/apply"
    item = {"partId": PART, "description": "Install verified brake pads", "quantity": "2"}
    assert client.post(path, headers=headers(), json={"items": [{**item, "partId": UNSUPPORTED}]}).status_code == 422
    assert client.post(path, headers=headers(), json={"items": [{**item, "unitPrice": "0.01"}]}).status_code == 422
    assert not domain.mutations
    for _ in range(2):
        saved = client.post(path, headers=headers(), json={"items": [item]})
        assert saved.status_code == 200, saved.text
        assert saved.json()["status"] == "DRAFT"
    assert domain.mutations[0] == domain.mutations[1]
    method, idem, sent = domain.mutations[0]
    assert method == "POST" and idem == f"ai-{KEY_ID}"
    assert sent["workOrderId"] == JOB and sent["branchId"] == BRANCH
    assert sent["items"] == [{**item, "itemType": "PART", "unitPrice": "0", "discountPercent": "0"}]
    assert "status" not in sent
    revised = client.post(path, headers=headers(), json={"items": [item], "estimateId": BILL, "version": 2})
    assert revised.status_code == 200 and domain.mutations[-1][0] == "PATCH"
    assert domain.mutations[-1][2]["version"] == 2


def test_rechecks_branch_and_permission_before_read_or_apply(stack):
    client, _, domain = stack
    assert generate(client).status_code == 200
    domain.branch = OTHER
    assert client.get(f"{BASE}/drafts/{KEY_ID}", headers=headers()).status_code == 403
    domain.branch = BRANCH
    domain.permissions.remove("ESTIMATE_CREATE")
    assert client.post(f"{BASE}/drafts/{KEY_ID}/apply", headers=headers(),
                       json={"items": [{"description": "Labor", "quantity": 1}]}).status_code == 403
    assert not domain.mutations
