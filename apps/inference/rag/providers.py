"""Small, explicit provider adapters for the one RAG generation call.

Retrieval and server-owned citation attribution never vary by provider.  This
module only normalises the provider request into the JSON text expected by the
existing RAG parser.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_GEMINI_RAG_MODEL = "gemma-4-31b-it"
DEFAULT_OPENROUTER_RAG_MODEL = "google/gemma-4-26b-a4b-it"


@dataclass(frozen=True)
class RagProvider:
    name: str
    model: str
    api_key: str


@dataclass(frozen=True)
class ProviderCompletion:
    text: str
    response_count: int
    text_part_count: int
    thought_part_count: int = 0
    usage: dict[str, object] | None = None
    route: str | None = None


class ProviderRequestError(RuntimeError):
    """Provider HTTP failure with safe fields for operational logs only."""

    def __init__(self, status_code: int | None, status: str, message: str) -> None:
        self.status_code = status_code
        self.status = status
        self.response_json = {"error": {"code": status_code, "status": status}}
        super().__init__(message)


def selected_rag_provider(environ: dict[str, str] | None = None) -> RagProvider:
    """Resolve the provider without silently changing a production default."""
    env = os.environ if environ is None else environ
    name = env.get("NAYANA_RAG_PROVIDER", "gemini").strip().lower()
    if name == "gemini":
        return RagProvider(
            name=name,
            model=env.get("NAYANA_RAG_GEMINI_MODEL", DEFAULT_GEMINI_RAG_MODEL).strip(),
            api_key=env.get("GEMINI_API_KEY", "").strip(),
        )
    if name == "openrouter":
        return RagProvider(
            name=name,
            model=env.get("NAYANA_RAG_OPENROUTER_MODEL", DEFAULT_OPENROUTER_RAG_MODEL).strip(),
            api_key=env.get("OPENROUTER_API_KEY", "").strip(),
        )
    raise ValueError("NAYANA_RAG_PROVIDER must be 'gemini' or 'openrouter'")


def openrouter_completion(*, provider: RagProvider, instruction: str, payload: str,
                          timeout_ms: int, max_output_tokens: int) -> ProviderCompletion:
    """Make one non-streaming OpenRouter request while preserving JSON contract.

    Non-streaming is intentional for this short one-field response.  It avoids
    adding a second SSE parser while leaving Gemini's existing stream handling
    untouched, so this experiment isolates provider routing rather than client
    stream parsing.
    """
    body = {
        "model": provider.model,
        "messages": [
            {"role": "system", "content": instruction},
            {"role": "user", "content": payload},
        ],
        "max_tokens": max_output_tokens,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    request = Request(
        OPENROUTER_CHAT_URL,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {provider.api_key}",
            "Content-Type": "application/json",
            # Lets our safe telemetry report the routed provider without
            # logging prompt, evidence, or generated content.
            "X-OpenRouter-Metadata": "enabled",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout_ms / 1000) as response:
            raw = response.read()
    except HTTPError as error:
        try:
            body = json.loads(error.read().decode("utf-8", errors="replace"))
        except json.JSONDecodeError:
            body = {}
        provider_error = body.get("error", {}) if isinstance(body, dict) else {}
        raise ProviderRequestError(error.code, "HTTP_ERROR", str(provider_error.get("message", "OpenRouter request failed"))) from None
    except URLError as error:
        raise ProviderRequestError(None, "NETWORK_ERROR", str(error.reason)) from None

    try:
        decoded = json.loads(raw)
        content = decoded["choices"][0]["message"]["content"]
    except (IndexError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise ProviderRequestError(None, "INVALID_RESPONSE", "OpenRouter returned no usable assistant content") from error
    if not isinstance(content, str) or not content.strip():
        raise ProviderRequestError(None, "EMPTY_RESPONSE", "OpenRouter returned empty assistant content")

    metadata = decoded.get("openrouter_metadata", {}) if isinstance(decoded, dict) else {}
    route = metadata.get("provider_name") if isinstance(metadata, dict) else None
    usage = decoded.get("usage") if isinstance(decoded, dict) and isinstance(decoded.get("usage"), dict) else None
    return ProviderCompletion(text=content, response_count=1, text_part_count=1,
                              usage=usage, route=route if isinstance(route, str) else None)
