"""Small, explicit provider adapters for the one RAG generation call.

Retrieval and server-owned citation attribution never vary by provider.  This
module only normalises the provider request into the JSON text expected by the
existing RAG parser.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"
NETRA_CHAT_URL = "https://api.netraruntime.com/v1/chat/completions"
DEFAULT_GEMINI_RAG_MODEL = "gemma-4-31b-it"
DEFAULT_OPENROUTER_RAG_MODEL = "google/gemma-4-26b-a4b-it"
DEFAULT_NETRA_RAG_MODEL = "deepseek/deepseek-v4-flash-0731"
logger = logging.getLogger(__name__)


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
    if name == "netra":
        return RagProvider(
            name=name,
            model=env.get("NAYANA_RAG_NETRA_MODEL", DEFAULT_NETRA_RAG_MODEL).strip(),
            api_key=env.get("NETRA_API_KEY", "").strip(),
        )
    raise ValueError("NAYANA_RAG_PROVIDER must be 'gemini', 'openrouter', or 'netra'")


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


def netra_completion(*, provider: RagProvider, instruction: str, payload: str,
                     timeout_ms: int, max_output_tokens: int,
                     response_schema: dict | None = None) -> ProviderCompletion:
    """Complete the legacy JSON endpoint through Netra without Gemini fallback.

    The browser no longer uses this compatibility path, but retained callers
    must receive the same schema-safe answer contract as the streaming route.
    """
    local_request_id = uuid.uuid4().hex
    response_format: dict[str, object] = {"type": "json_object"}
    if response_schema is not None:
        response_format = {
            "type": "json_schema",
            "json_schema": {
                "name": "nayana_grounded_answer",
                "strict": True,
                "schema": response_schema,
            },
        }
    body = {
        "model": provider.model,
        "messages": [
            {"role": "system", "content": instruction},
            {"role": "user", "content": payload},
        ],
        "max_tokens": max_output_tokens,
        "temperature": 0.2,
        "reasoning": {"effort": "low", "exclude": True},
        "response_format": response_format,
    }
    request = Request(
        NETRA_CHAT_URL,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {provider.api_key}",
            "Content-Type": "application/json",
            "X-Netra-Agent": "nayana-screening-chat",
            "X-Request-Id": local_request_id,
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout_ms / 1000) as response:
            raw = response.read()
            netra_request_id = response.headers.get("X-Request-Id") or local_request_id
    except HTTPError as error:
        raise ProviderRequestError(error.code, "HTTP_ERROR", "Netra request failed") from None
    except URLError as error:
        raise ProviderRequestError(None, "NETWORK_ERROR", str(error.reason)) from None

    try:
        decoded = json.loads(raw)
        content = decoded["choices"][0]["message"]["content"]
    except (IndexError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise ProviderRequestError(None, "INVALID_RESPONSE", "Netra returned no usable assistant content") from error
    if not isinstance(content, str) or not content.strip():
        raise ProviderRequestError(None, "EMPTY_RESPONSE", "Netra returned empty assistant content")

    usage = decoded.get("usage") if isinstance(decoded, dict) and isinstance(decoded.get("usage"), dict) else None
    logger.warning("Netra completion usage request_id=%s usage=%s", netra_request_id, usage)
    return ProviderCompletion(text=content, response_count=1, text_part_count=1, usage=usage,
                              route="netra")


def openrouter_text_stream(*, provider: RagProvider, instruction: str, payload: str,
                           timeout_ms: int, max_output_tokens: int):
    """Yield OpenRouter text fragments without parsing or exposing them publicly.

    The caller owns sentence buffering and evidence attribution. This adapter
    only decodes provider SSE framing so the existing JSON path stays unchanged.
    """
    body = {
        "model": provider.model,
        "messages": [
            {"role": "system", "content": instruction},
            {"role": "user", "content": payload},
        ],
        "max_tokens": max_output_tokens,
        "temperature": 0.2,
        "stream": True,
    }
    request = Request(
        OPENROUTER_CHAT_URL,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {provider.api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    try:
        response = urlopen(request, timeout=timeout_ms / 1000)
    except HTTPError as error:
        try:
            response_body = json.loads(error.read().decode("utf-8", errors="replace"))
        except json.JSONDecodeError:
            response_body = {}
        provider_error = response_body.get("error", {}) if isinstance(response_body, dict) else {}
        raise ProviderRequestError(error.code, "HTTP_ERROR", str(provider_error.get("message", "OpenRouter request failed"))) from None
    except URLError as error:
        raise ProviderRequestError(None, "NETWORK_ERROR", str(error.reason)) from None

    received_text = False
    try:
        for raw_line in response:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line or not line.startswith("data:"):
                continue
            data = line.removeprefix("data:").strip()
            if data == "[DONE]":
                break
            try:
                event = json.loads(data)
                delta = event["choices"][0].get("delta", {})
                content = delta.get("content") if isinstance(delta, dict) else None
            except (IndexError, KeyError, TypeError, json.JSONDecodeError) as error:
                raise ProviderRequestError(None, "INVALID_STREAM", "OpenRouter returned an invalid stream event") from error
            if isinstance(content, str) and content:
                received_text = True
                yield content
    finally:
        response.close()
    if not received_text:
        raise ProviderRequestError(None, "EMPTY_RESPONSE", "OpenRouter returned empty assistant content")


def netra_text_stream(*, provider: RagProvider, instruction: str, payload: str,
                      timeout_ms: int, max_output_tokens: int):
    """Yield Netra content deltas internally for sentence-level attribution.

    The Netra request is text-only with low reasoning effort. Reasoning output,
    raw content deltas, and provider metadata never leave this module for the
    browser.
    """
    local_request_id = uuid.uuid4().hex
    body = {
        "model": provider.model,
        "messages": [
            {"role": "system", "content": instruction},
            {"role": "user", "content": payload},
        ],
        "max_tokens": max_output_tokens,
        "temperature": 0.2,
        "stream": True,
        "stream_options": {"include_usage": True},
        "reasoning": {"effort": "low", "exclude": True},
    }
    request = Request(
        NETRA_CHAT_URL,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {provider.api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "X-Netra-Agent": "nayana-screening-chat",
            "X-Request-Id": local_request_id,
        },
        method="POST",
    )
    try:
        response = urlopen(request, timeout=timeout_ms / 1000)
    except HTTPError as error:
        raise ProviderRequestError(error.code, "HTTP_ERROR", "Netra request failed") from None
    except URLError as error:
        raise ProviderRequestError(None, "NETWORK_ERROR", str(error.reason)) from None

    netra_request_id = response.headers.get("X-Request-Id") or local_request_id
    received_text = False
    finish_reason = None
    data_lines: list[str] = []

    def events():
        for raw_line in response:
            line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
            if not line:
                if data_lines:
                    yield "\n".join(data_lines)
                    data_lines.clear()
                continue
            if line.startswith("data:"):
                data_lines.append(line.removeprefix("data:").lstrip())
        if data_lines:
            yield "\n".join(data_lines)
            data_lines.clear()

    try:
        for data in events():
            if data == "[DONE]":
                break
            try:
                event = json.loads(data)
            except json.JSONDecodeError as error:
                raise ProviderRequestError(None, "INVALID_STREAM", "Netra returned an invalid stream event") from error
            if not isinstance(event, dict):
                raise ProviderRequestError(None, "INVALID_STREAM", "Netra returned an invalid stream event")
            if event.get("error"):
                raise ProviderRequestError(None, "STREAM_ERROR", "Netra stream ended with an error")
            usage = event.get("usage")
            if isinstance(usage, dict):
                logger.warning("Netra stream usage request_id=%s usage=%s", netra_request_id, usage)
            choices = event.get("choices") or []
            if not choices:
                continue
            choice = choices[0]
            if not isinstance(choice, dict):
                raise ProviderRequestError(None, "INVALID_STREAM", "Netra returned an invalid stream event")
            finish_reason = choice.get("finish_reason") or finish_reason
            delta = choice.get("delta") or {}
            content = delta.get("content") if isinstance(delta, dict) else None
            if isinstance(content, str) and content:
                received_text = True
                yield content
    finally:
        response.close()

    if finish_reason == "length":
        raise ProviderRequestError(None, "INCOMPLETE_RESPONSE", "Netra reached the output limit")
    if not received_text:
        raise ProviderRequestError(None, "EMPTY_RESPONSE", "Netra returned empty assistant content")
