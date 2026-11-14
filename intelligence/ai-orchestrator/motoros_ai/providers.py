"""Bounded provider calls. No provider is enabled by default."""
import json
import os
from contextlib import closing
from dataclasses import dataclass
from typing import Protocol

import httpx


class ProviderFailure(Exception):
    pass


@dataclass(frozen=True)
class Inference:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    provider_request_id: str | None = None


class Provider(Protocol):
    identifier: str

    def generate(self, system: str, data: dict, schema: dict) -> Inference: ...


class Bedrock:
    def __init__(self, region: str, model: str):
        self.region = region
        self.model = model
        self.identifier = f"bedrock/{region}/{model}"

    def generate(self, system: str, data: dict, schema: dict) -> Inference:
        import boto3
        from botocore.config import Config
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            with closing(boto3.client(
                "bedrock-runtime",
                region_name=self.region,
                config=Config(connect_timeout=2, read_timeout=12,
                              retries={"total_max_attempts": 1}, max_pool_connections=4),
            )) as client:
                result = client.converse(
                    modelId=self.model,
                    system=[{"text": system + "\nReturn JSON matching: " + json.dumps(schema)}],
                    messages=[{"role": "user", "content": [{"text": json.dumps(data)}]}],
                    inferenceConfig={"maxTokens": 700, "temperature": 0},
                )
            if result["stopReason"] not in ("end_turn", "stop_sequence"):
                raise ProviderFailure()
            blocks = result["output"]["message"]["content"]
            usage = result.get("usage", {})
            return Inference(
                "".join(block.get("text", "") for block in blocks),
                usage.get("inputTokens", 0),
                usage.get("outputTokens", 0),
                result.get("ResponseMetadata", {}).get("RequestId"),
            )
        except (BotoCoreError, ClientError, ImportError, KeyError, ValueError) as error:
            raise ProviderFailure() from error


class Ollama:
    def __init__(self, url: str, model: str):
        self.url = url.rstrip("/")
        self.model = model
        self.identifier = f"ollama/{model}"

    def generate(self, system: str, data: dict, schema: dict) -> Inference:
        try:
            with httpx.Client(timeout=httpx.Timeout(12, connect=2), trust_env=False) as client:
                with client.stream("POST", self.url + "/api/chat", json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": json.dumps(data)},
                    ],
                    "format": schema, "stream": False,
                    "options": {"num_predict": 700, "temperature": 0},
                }) as response:
                    response.raise_for_status()
                    buffer = bytearray()
                    for chunk in response.iter_bytes():
                        buffer.extend(chunk)
                        if len(buffer) > 32768:
                            raise ProviderFailure()
                    result = json.loads(buffer)
            if not result.get("done") or result.get("done_reason") == "length":
                raise ProviderFailure()
            return Inference(result["message"]["content"], result.get("prompt_eval_count", 0),
                             result.get("eval_count", 0))
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as error:
            raise ProviderFailure() from error


def configured_provider() -> Provider | None:
    provider = os.getenv("AI_PROVIDER", "disabled")
    model = os.getenv("AI_MODEL", "")
    if provider == "nvidia":
        from .nvidia import MODEL, Nvidia

        key = os.getenv("NVIDIA_API_KEY", "").strip()
        if os.getenv("AI_ALLOW_NVIDIA") == "true" and key and (not model or model == MODEL):
            return Nvidia(MODEL, key)
        return None
    if not model or len(model) > 150:
        return None
    if provider == "ollama" and os.getenv("AI_OLLAMA_URL"):
        return Ollama(os.environ["AI_OLLAMA_URL"], model)
    if (provider == "bedrock" and os.getenv("AI_ALLOW_BEDROCK") == "true"
            and os.getenv("AI_BEDROCK_APPROVED_MODEL") == model):
        return Bedrock(os.getenv("AWS_REGION", "ap-south-1"), model)
    return None
