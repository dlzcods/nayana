from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ARTIFACTS = Path(os.getenv("NAYANA_RAG_ARTIFACTS", str(ROOT.parent / "artifacts" / "nei-rag")))
MODEL = "intfloat/multilingual-e5-small"
ATTRIBUTION = "Courtesy: National Eye Institute, National Institutes of Health (NEI/NIH)."


def sources() -> list[dict]:
    return json.loads((ROOT / "sources.json").read_text())


def digest(value: str | bytes) -> str:
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def write_json(path: Path, value: object) -> None:
    """Atomic artifact writes: an interrupted run cannot replace a good snapshot."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)
