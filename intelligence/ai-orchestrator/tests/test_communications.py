from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from motoros_ai.app import create_app
from motoros_ai.communications import NewDraft, choose_tone
from motoros_ai.providers import Inference, ProviderFailure


KEY = "synthetic-communication-gateway-key"
TENANT = str(uuid4())
PREFIX = "/api/ai/communications/"
INPUT = {k: str(uuid4()) for k in ("branchId", "customerId", "vehicleId", "resourceId")}
INPUT.update(purpose="INVOICE_AVAILABLE", channel="EMAIL", language="ta", tone="AUTO")
HEADERS = {"Authorization": "Bearer fixture", "X-MotorOS-Tenant": TENANT,
           "X-MotorOS-AI-Key": KEY, "X-MotorOS-Actor": "a" * 64}


class Quota:
    def reserve(self, tenant, feature, limit):
        return True

    def record(self, *args):
        pass


@pytest.mark.parametrize(("result", "expected"), [
    ('{"tone":"FRIENDLY"}', "FRIENDLY"),
    ('{"tone":"FRIENDLY","body":"Invented"}', "PROFESSIONAL"),
    ('{"tone":"PERSUASIVE"}', "PROFESSIONAL"),
    (None, "PROFESSIONAL"),
])
def test_model_can_only_select_tone_and_never_sees_customer_context(result, expected):
    class Provider:
        def generate(self, system, data, schema):
            assert data == {"purpose": "INVOICE_AVAILABLE", "language": "ta", "channel": "EMAIL"}
            if result is None:
                raise ProviderFailure()
            return Inference(result)
    assert choose_tone(NewDraft(**INPUT), Provider(), Quota(), TENANT) == expected


def test_gateway_forwards_identity_and_rejects_unverified_message_text():
    captured = []
    def upstream(request):
        assert request.headers["Authorization"] == "Bearer fixture"
        assert request.headers["X-MotorOS-Tenant"] == TENANT
        assert "X-MotorOS-AI-Key" not in request.headers
        captured.append(request)
        return httpx.Response(200, json={"status": "DRAFT"})

    with TestClient(create_app(transport=httpx.MockTransport(upstream), service_key=KEY)) as client:
        assert client.post(PREFIX + "draft", json=INPUT).status_code == 403
        assert client.post(PREFIX + "draft", headers=HEADERS,
                           json={**INPUT, "body": "Unverified charges"}).status_code == 422
        assert client.post(PREFIX + "draft", headers=HEADERS, json=INPUT).status_code == 200
        draft = str(uuid4())
        assert client.post(PREFIX + f"drafts/{draft}/send", headers=HEADERS,
                           json={"version": 1, "confirmed": False}).status_code == 422
        assert client.patch(PREFIX + f"drafts/{draft}", headers=HEADERS,
                            json={"version": 1, "language": "ta", "tone": "CONCISE",
                                  "includeDetails": False}).status_code == 200
        assert [request.method for request in captured] == ["POST", "PATCH"]
        assert captured[0].url.path == "/api/notifications/assistant/draft"
        assert b'"tone":"PROFESSIONAL"' in captured[0].content
