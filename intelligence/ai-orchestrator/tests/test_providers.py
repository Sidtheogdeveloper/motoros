import json

import boto3
import pytest
from botocore.stub import Stubber

from motoros_ai.providers import Bedrock, ProviderFailure


def client():
    # Synthetic local credentials prevent SDK credential lookup. Stubber intercepts all requests.
    return boto3.client(
        "bedrock-runtime", region_name="ap-south-1",
        aws_access_key_id="synthetic", aws_secret_access_key="synthetic",
    )


def test_bedrock_converse_contract_without_network(monkeypatch):
    runtime = client()
    payload = {"evidence": [{"id": 1, "category": "Completed repair", "text": "Changed oil"}]}
    schema = {"type": "object"}
    expected = {
        "modelId": "test-model",
        "system": [{"text": "select evidence\nReturn JSON matching: " + json.dumps(schema)}],
        "messages": [{"role": "user", "content": [{"text": json.dumps(payload)}]}],
        "inferenceConfig": {"maxTokens": 700, "temperature": 0},
    }
    monkeypatch.setattr(boto3, "client", lambda *args, **kwargs: runtime)
    with Stubber(runtime) as stub:
        stub.add_response("converse", {
            "output": {"message": {"role": "assistant", "content": [{"text": '{"evidence":[1]}'}]}},
            "stopReason": "end_turn",
            "usage": {"inputTokens": 32, "outputTokens": 8, "totalTokens": 40},
            "metrics": {"latencyMs": 20},
            "ResponseMetadata": {"RequestId": "fixture-request"},
        }, expected)
        result = Bedrock("ap-south-1", "test-model").generate("select evidence", payload, schema)
        stub.assert_no_pending_responses()
    assert result.text == '{"evidence":[1]}'
    assert (result.input_tokens, result.output_tokens, result.provider_request_id) == (
        32, 8, "fixture-request",
    )


def test_bedrock_failure_is_normalized(monkeypatch):
    runtime = client()
    monkeypatch.setattr(boto3, "client", lambda *args, **kwargs: runtime)
    with Stubber(runtime) as stub:
        stub.add_client_error("converse", service_error_code="ThrottlingException")
        with pytest.raises(ProviderFailure):
            Bedrock("ap-south-1", "test-model").generate("select evidence", {}, {})
        stub.assert_no_pending_responses()
