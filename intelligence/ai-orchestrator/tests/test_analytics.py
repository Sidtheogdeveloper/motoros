from datetime import date
from uuid import UUID

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from motoros_ai.analytics import Question, history, metadata, parse
from motoros_ai.app import create_app
from motoros_ai.storage import Store
from motoros_ai.vehicle_history import DomainError

TENANT, OTHER, A, B = [str(UUID(int=i)) for i in range(1, 5)]
TODAY = date(2026, 11, 7)
LABELS = {A: "Anna Nagar", B: "OMR"}
KEY = "synthetic-analytics-gateway-key-for-tests"
PATH = "/api/ai/analytics/"


@pytest.mark.parametrize(("question", "metric", "group"), [
    ("Which branch generated the most revenue last month?", "collected_payments", "branch"),
    ("Compare service volume across all branches.", "completed_work_orders", "branch"),
    ("What are our most frequently replaced parts?", "parts_consumption", "part"),
    ("Which branch has the longest average repair time?", "average_turnaround", "branch"),
    ("How many customers returned within six months?", "repeat_customer_count", "total"),
    ("How many invoices remain unpaid?", "unpaid_invoices", "total"),
    ("Which services generate the highest average invoice value?", "average_invoice_value", "service"),
    ("What percentage of estimates are approved?", "estimate_approval_rate", "total"),
    ("Show monthly revenue trends.", "collected_payments", "month"),
    ("Show invoice totals in OMR", "invoice_value", "total"),
])
def test_intent_catalog(question, metric, group):
    spec = parse(Question(question=question), {A, B}, LABELS, today=TODAY)
    assert spec["metric"] == metric and spec["groupBy"] == group
    if "last month" in question:
        assert spec["dateRange"] == {"start": "2026-10-01", "end": "2026-11-01"}
    if "OMR" in question:
        assert spec["branchIds"] == [B]


@pytest.mark.parametrize("body", [
    {"question": "SELECT revenue FROM billing.invoices"},
    {"question": "Show profit"},
    {"question": "Branch utilization"},
    {"question": "Show revenue last 999 days"},
    {"question": "Show revenue last month", "start": "2026-10-01", "end": "2026-11-01"},
    {"question": "Show revenue", "start": "2026-01-01"},
    {"question": "Show revenue and invoice value"},
    {"question": "How many confirmed appointments?"},
    {"question": "Show revenue last month in Atlantis"},
    {"question": "Show revenue last month in INR and USD"},
])
def test_unsupported_and_invalid_questions(body):
    with pytest.raises(DomainError) as error:
        parse(Question(**body), {A, B}, LABELS, today=TODAY)
    assert error.value.status == 422


class Upstream:
    def __init__(self):
        self.branches = [A, B]
        self.allowed = True
        self.queries = []

    def __call__(self, request):
        tenant = request.headers["X-MotorOS-Tenant"]
        path = request.url.path
        if path == "/api/me/permissions":
            permissions = ["ANALYTICS_BRANCH_READ", "AI_ANALYTICS_USE"] if self.allowed else []
            return httpx.Response(200, json={"tenantId": tenant, "branches": self.branches, "permissions": permissions})
        if path == "/api/branches":
            return httpx.Response(200, json=[{"id": k, "name": v} for k, v in LABELS.items()])
        assert path == "/api/analytics/metrics"
        params = request.url.params
        self.queries.append(dict(params))
        return httpx.Response(200, json={
            "rows": [{"label": A, "value": "118.09", "currency": "INR"}],
            "branchIds": params.get_list("branchId"), "unit": "money",
            "truncated": False, "staleBranchIds": [B], "freshness": [],
            "asOf": "2026-11-07T00:00:00Z",
        })


def auth(tenant=TENANT, actor="a"):
    return {"Authorization": "Bearer fixture", "X-MotorOS-Tenant": tenant,
            "X-MotorOS-AI-Key": KEY, "X-MotorOS-Actor": actor * 64}


def test_results_use_owner_api_and_history_rechecks_scope():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    metadata.create_all(engine)
    upstream = Upstream()
    with TestClient(create_app(store=Store(engine), service_key=KEY,
                              transport=httpx.MockTransport(upstream))) as client:
        response = client.post(PATH + "query", headers=auth(),
                               json={"question": "Compare revenue by branch"})
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["rows"][0]["value"] == "118.09"
        assert result["chart"]["type"] == "bar" and result["rows"][0]["label"] == "Anna Nagar"
        assert result["staleBranchIds"] == [B]
        assert upstream.queries[0]["metric"] == "collected_payments"
        assert client.get(PATH + "query-history", headers=auth(OTHER)).json()["queries"] == []
        assert client.get(PATH + "query-history", headers=auth(actor="b")).json()["queries"] == []
        assert client.get(PATH + "query-history", headers=auth()).json()["queries"][0]["id"] == result["queryId"]
        with engine.connect() as connection:
            assert "118.09" not in str(connection.execute(history.select()).all())
        follow = client.post(PATH + "query", headers=auth(), json={
            "question": "What about last month?", "previousQueryId": result["queryId"],
        })
        assert follow.status_code == 200
        assert follow.json()["spec"]["groupBy"] == "branch"
        upstream.branches = [A]
        assert client.get(PATH + "query-history", headers=auth()).json()["queries"] == []
        assert client.post(PATH + "query", headers=auth(), json={
            "question": "Run again", "previousQueryId": result["queryId"],
        }).status_code == 404
        assert client.post(PATH + "query", headers=auth(), json={
            "question": "Revenue", "branchIds": [B],
        }).status_code == 403
        upstream.allowed = False
        assert client.get(PATH + "query-history", headers=auth()).status_code == 403
