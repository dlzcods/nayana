"""Retrieval evaluation is evidence-location testing, NOT clinical validation."""
import json
from pathlib import Path
import time

from .common import write_json
from .retrieve import Retriever, contextual_query


def evaluate(index_path: Path, cases_path: Path) -> dict:
    start = time.monotonic()
    retriever = Retriever(index_path)
    load_seconds = time.monotonic() - start
    rows = []
    for line in cases_path.read_text().splitlines():
        case = json.loads(line)
        query = contextual_query(case["question"], case.get("history", []), case.get("topic", "normal"))
        start = time.monotonic()
        hits = retriever.search(query)
        expected = case.get("expected_sources", [])
        import re
        supported = bool(expected)
        hit = any(row["source_id"] in expected and
                  (not case.get("heading") or re.search(case["heading"], row["heading"], re.I)) for row in hits)
        rows.append({**case, "query": query, "supported": supported, "hit_at_4": hit if supported else None,
                     "seconds": round(time.monotonic() - start, 4),
                     "hits": [{"id": row["id"], "source": row["source_id"], "heading": row["heading"],
                               "score": round(row["score"], 4)} for row in hits]})
    summary = {}
    for split in ("development", "heldout"):
        supported_rows = [row for row in rows if row["split"] == split and row["supported"]]
        summary[split] = {"supported_cases": len(supported_rows),
                          "hit_at_4": sum(row["hit_at_4"] for row in supported_rows) / max(1, len(supported_rows))}
    report = {"version": retriever.version, "encoder_load_seconds": round(load_seconds, 3),
              "summary": summary, "cases": rows,
              "note": "Unsupported cases require generation/abstention evaluation; vector search always returns neighbours."}
    write_json(index_path / "retrieval-evaluation.json", report)
    return report
