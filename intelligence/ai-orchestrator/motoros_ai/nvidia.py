"""NVIDIA's hosted NIM API, using a fixed TLS destination."""
import json

import httpx

from .providers import Inference, ProviderFailure

MODEL = "nvidia/nemotron-3-ultra-550b-a55b"
ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions"


class Nvidia:
    def __init__(self, model: str, api_key: str):
        self.model = model
        self._api_key = api_key
        self.identifier = f"nim/{model}"

    def generate(self, system: str, data: dict, schema: dict) -> Inference:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system + "\nReturn JSON matching: " + json.dumps(schema)},
                {"role": "user", "content": json.dumps(data, ensure_ascii=False)},
            ],
            "chat_template_kwargs": {"enable_thinking": False},
            "temperature": 0,
            "max_tokens": 700,
            "stream": False,
        }
        try:
            with httpx.Client(timeout=httpx.Timeout(14, connect=3), trust_env=False) as client:
                with client.stream("POST", ENDPOINT, json=payload, headers={
                    "Authorization": "Bearer " + self._api_key,
                    "Accept": "application/json",
                }) as response:
                    response.raise_for_status()
                    request_id = response.headers.get("x-request-id")
                    buffer = bytearray()
                    for chunk in response.iter_bytes():
                        if len(buffer) + len(chunk) > 32768:
                            raise ProviderFailure("NVIDIA response exceeded the size limit.")
                        buffer.extend(chunk)
                    result = json.loads(buffer)
            choice = result["choices"][0]
            content = choice["message"]["content"]
            if choice["finish_reason"] != "stop" or not isinstance(content, str) or not content.strip():
                raise ProviderFailure("NVIDIA returned an incomplete completion.")
            usage = result.get("usage") or {}
            counts = (usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0))
            if any(type(count) is not int or count < 0 for count in counts):
                raise ProviderFailure("NVIDIA returned invalid usage metadata.")
            return Inference(content, *counts, request_id)
        except httpx.HTTPStatusError as error:
            raise ProviderFailure(f"NVIDIA HTTP status {error.response.status_code}.") from None
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as error:
            raise ProviderFailure("NVIDIA response unavailable.") from None
