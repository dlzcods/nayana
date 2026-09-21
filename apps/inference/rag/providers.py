"""Netra Runtime adapter for NAYANA's text-only LLM calls.

Modal owns screening inference, retrieval, citation attribution, and report
generation. This module sends only the minimum text context required for
Chat NAYANA or a structured result explanation to Netra Runtime. Fundus photos
never enter this request path.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


NETRA_CHAT_URL = "https://api.netraruntime.com/v1/chat/completions"
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
    """Provider failure with safe fields for operational logs only."""

    def __init__(self, status_code: int | None, status: str, message: str) -> None:
        self.status_code = status_code
        self.status = status
        self.response_json = {"error": {"code": status_code, "status": status}}
        super().__init__(message)


def selected_rag_provider(environ: dict[str, str] | None = None) -> RagProvider:
    """Resolve the single production LLM route without a silent fallback."""

    env = os.environ if environ is None else environ
    name = env.get("NAYANA_RAG_PROVIDER", "netra").strip().lower()
    if name != "netra":
        raise ValueError("NAYANA_RAG_PROVIDER must be 'netra'")
    return RagProvider(
        name="netra",
        model=env.get("NAYANA_RAG_NETRA_MODEL", DEFAULT_NETRA_RAG_MODEL).strip(),
        api_key=env.get("NETRA_API_KEY", "").strip(),
    )


def netra_completion(*, provider: RagProvider, instruction: str, payload: str,
                     timeout_ms: int, max_output_tokens: int,
                     response_schema: dict | None = None) -> ProviderCompletion:
    """Make one non-streaming, reasoning-excluded Netra completion request."""

    local_request_id = uuid.uuid4().hex
    response_format: dict[str, object] = {"type": "json_object"}
    if response_schema is not None:
        response_format = {
            "type": "json_schema",
            "json_schema": {
                "name": "nayana_response",
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
            request_id = response.headers.get("X-Request-Id") or local_request_id
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
    logger.warning("Netra completion usage request_id=%s usage=%s", request_id, usage)
    return ProviderCompletion(text=content, response_count=1, text_part_count=1, usage=usage, route="netra")


def netra_text_stream(*, provider: RagProvider, instruction: str, payload: str,
                      timeout_ms: int, max_output_tokens: int):
    """Yield only visible content deltas for server-side citation attribution."""

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

    request_id = response.headers.get("X-Request-Id") or local_request_id
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
                logger.warning("Netra stream usage request_id=%s usage=%s", request_id, usage)
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
