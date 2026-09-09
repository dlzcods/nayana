"""Privacy-safe per-request metadata for RAG incident analysis.

Never put question text, evidence text, source URLs, screening IDs, image data,
or model output in this module. The trace exists solely to correlate retrieval
selection with provider behaviour under concurrent requests.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
import uuid


_current_trace: ContextVar[dict[str, object] | None] = ContextVar("nayana_rag_trace", default=None)


def retrieval_metadata(*, question: str, query: str, payload: str, evidence: list[dict],
                       memory_intent: str | None, instruction: str) -> dict[str, object]:
    source_ids = list(dict.fromkeys(str(row.get("source_id", "unknown")) for row in evidence))
    headings = list(dict.fromkeys(str(row.get("heading", "")) for row in evidence if row.get("heading")))
    guards = sorted({guard for row in evidence for guard in row.get("retrieval", {}).get("topic_guard", [])})
    retrieval_candidates = [{
        "source_id": str(row.get("source_id", "unknown")),
        "heading": str(row.get("heading", "")),
        "rrf_score": round(float(row.get("score", 0.0)), 6),
        "dense_rank": row.get("retrieval", {}).get("dense_rank"),
        "lexical_rank": row.get("retrieval", {}).get("lexical_rank"),
    } for row in evidence]
    return {
        "trace_id": uuid.uuid4().hex[:12],
        "question_characters": len(question),
        "query_characters": len(query),
        "payload_characters": len(payload),
        "instruction_characters": len(instruction),
        "evidence_count": len(evidence),
        "evidence_characters": sum(len(str(row.get("text", ""))) for row in evidence),
        "source_ids": source_ids,
        "headings": headings,
        "retrieval_candidates": retrieval_candidates,
        "topic_guard": guards,
        "memory_intent": memory_intent or "none",
    }


@contextmanager
def scoped_trace(metadata: dict[str, object]):
    token = _current_trace.set(metadata)
    try:
        yield
    finally:
        _current_trace.reset(token)


def current_trace() -> dict[str, object]:
    return _current_trace.get() or {"trace_id": "unscoped"}
