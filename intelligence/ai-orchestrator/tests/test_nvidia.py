import json

import httpx
import pytest

from motoros_ai import nvidia
from motoros_ai.providers import ProviderFailure, configured_provider
from motoros_ai.vehicle_history import Selection, validate_selection


def mock_endpoint(monkeypatch, handler):
    real_client = httpx.Client
    monkeypatch.setattr(nvidia.httpx, "Client", lambda **options: real_client(
        transport=httpx.MockTransport(handler), **options,
    ))


def test_nvidia_uses_fixed_endpoint_and_only_returns_final_content(monkeypatch):
    evidence = [{"id": 1, "text": "Fictional brake pad replacement"}]

    def respond(request):
        assert str(request.url) == nvidia.ENDPOINT
        assert request.headers["Authorization"] == "Bearer test-only"
        body = json.loads(request.content)
        assert body["model"] == nvidia.MODEL
        assert body["chat_template_kwargs"] == {"enable_thinking": False}
        assert body["stream"] is False
        assert body["max_tokens"] == 700
        return httpx.Response(200, headers={"x-request-id": "fixture"}, json={
            "choices": [{"finish_reason": "stop", "message": {
                "content": '{"evidence":[1]}', "reasoning_content": "untrusted reasoning",
            }}],
            "usage": {"prompt_tokens": 20, "completion_tokens": 7},
        })

    mock_endpoint(monkeypatch, respond)
    result = nvidia.Nvidia(nvidia.MODEL, "test-only").generate(
        "Select evidence", {"evidence": evidence}, Selection.model_json_schema(),
    )
    assert validate_selection(result.text, evidence) == [1]
    assert (result.input_tokens, result.output_tokens, result.provider_request_id) == (20, 7, "fixture")


@pytest.mark.parametrize("upstream", [
    httpx.Response(429, text="private error body"),
    httpx.Response(200, content=b"x" * 32769),
    httpx.Response(200, json={
        "choices": [{"finish_reason": "length", "message": {"content": '{"evidence":[]}'}}],
    }),
])
def test_nvidia_rejects_quota_errors_oversize_and_truncated_completions(monkeypatch, upstream):
    mock_endpoint(monkeypatch, lambda _: upstream)
    with pytest.raises(ProviderFailure) as failure:
        nvidia.Nvidia(nvidia.MODEL, "test-only").generate("Select evidence", {}, {})
    assert "private error body" not in str(failure.value)


def test_nvidia_requires_key_and_opt_in(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "nvidia")
    monkeypatch.delenv("AI_MODEL", raising=False)
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    monkeypatch.setenv("AI_ALLOW_NVIDIA", "true")
    assert configured_provider() is None
    monkeypatch.setenv("NVIDIA_API_KEY", "test-only")
    monkeypatch.setenv("AI_ALLOW_NVIDIA", "false")
    assert configured_provider() is None
    monkeypatch.setenv("AI_ALLOW_NVIDIA", "true")
    assert configured_provider().identifier == f"nim/{nvidia.MODEL}"
    monkeypatch.setenv("AI_MODEL", "unverified/model")
    assert configured_provider() is None
