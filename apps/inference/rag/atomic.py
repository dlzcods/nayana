"""Immutable, sentence-sized NEI evidence artifacts for atomic citations.

The legacy index remains the production baseline.  This module writes a separate
artifact beneath an existing corpus version and is only read when the explicit
``ACTIVE_CITATION_MODE`` is set to ``atomic`` in the application code.
"""
from __future__ import annotations

import json
import re
import tempfile
from pathlib import Path

from .common import ARTIFACTS, ATTRIBUTION, MODEL, digest, sources, write_json
from .index import load_manifest
from .prepare import plain, sections


ATOMIC_DIRECTORY = "atomic-citations-v1"
ATOMIC_UNIT_ALGORITHM = "heading-sentence-list-v1"


def _sentences(text: str) -> list[str]:
    """Return full sentences or list items without clipping source language."""
    units: list[str] = []
    for paragraph in re.split(r"\n\s*\n", text):
        for item in re.split(r"\n(?=\s*(?:[-*•]|\d+[.)])\s*)", paragraph.strip()):
            item = plain(item)
            if not item:
                continue
            if re.match(r"^(?:[-*•]|\d+[.)])\s*", item):
                units.append(item)
                continue
            units.extend(
                sentence.strip()
                for sentence in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])", item)
                if sentence.strip()
            )
    return units


def prepare_atomic(tokenizer) -> list[dict]:
    """Build stable source units from the approved raw snapshots only."""
    result: list[dict] = []
    for source in sources():
        raw = json.loads((ARTIFACTS / "raw" / f"{source['id']}.json").read_text())
        if raw.get("url") != source["url"] or digest(raw.get("markdown", "")) != raw.get("raw_sha256"):
            raise ValueError("Raw snapshot integrity/allowlist mismatch")
        title, parts, updated = sections(raw["markdown"])
        for part in parts:
            cursor = 0
            for ordinal, text in enumerate(_sentences(part["text"]), start=1):
                if len(text) < 8:
                    continue
                start = part["text"].find(text, cursor)
                if start < 0:
                    raise ValueError("Atomic source span cannot be resolved")
                end = start + len(text)
                cursor = end
                # Include the resolved span: identical wording can legitimately
                # occur twice in one section, yet each source occurrence needs
                # a distinct, stable citation target.
                unit_hash = digest(f"{part['heading']}\n{start}:{end}\n{text}")[:16]
                unit_id = f"{source['id']}-{unit_hash}"
                prefix = f"passage: {title} > {part['heading']}\n"
                embedding_text = prefix + text
                token_count = len(tokenizer.encode(embedding_text, add_special_tokens=True, truncation=False))
                if token_count > 512:
                    raise ValueError("Atomic source unit exceeds embedding budget")
                result.append({
                    "id": unit_id,
                    "source_unit_id": unit_id,
                    "source_id": source["id"],
                    "topic": source["topic"],
                    "ordinal": ordinal,
                    "url": source["url"],
                    "title": title,
                    "heading": part["heading"],
                    "text": text,
                    "embedding_text": embedding_text,
                    "token_count": token_count,
                    "start": start,
                    "end": end,
                    "source_updated_at": updated,
                    "fetched_at": raw["fetched_at"],
                    "attribution": ATTRIBUTION,
                })
    deduplicated = {row["id"]: row for row in result}
    if len(deduplicated) != len(result):
        raise ValueError("Atomic source unit identifier collision")
    return result


def atomic_path(version_path: Path) -> Path:
    return version_path / ATOMIC_DIRECTORY


def load_atomic_manifest(version_path: Path) -> dict:
    parent = load_manifest(version_path)
    path = atomic_path(version_path)
    manifest = json.loads((path / "manifest.json").read_text())
    if (manifest.get("base_version") != parent.get("version")
            or manifest.get("model") != MODEL
            or manifest.get("dimension") != 384
            or manifest.get("unit_algorithm") != ATOMIC_UNIT_ALGORITHM):
        raise ValueError("Unexpected atomic citation artifact")
    for filename, field in (("index.faiss", "index_sha256"), ("units.json", "units_sha256")):
        if digest((path / filename).read_bytes()) != manifest.get(field):
            raise ValueError("Atomic citation artifact integrity check failed")
    return manifest


def build_atomic(version_path: Path, encoder=None) -> dict:
    """Publish a complete atomic artifact without modifying its parent corpus."""
    import faiss
    import numpy as np
    from sentence_transformers import SentenceTransformer

    parent = load_manifest(version_path)
    destination = atomic_path(version_path)
    if destination.exists():
        return load_atomic_manifest(version_path)
    if encoder is None:
        encoder = SentenceTransformer(str(version_path / "encoder"), device="cpu", local_files_only=True)
    encoder.max_seq_length = 512
    units = prepare_atomic(encoder.tokenizer)
    vectors = encoder.encode([row["embedding_text"] for row in units], normalize_embeddings=True, show_progress_bar=False)
    vectors = np.ascontiguousarray(vectors, dtype="float32")
    if vectors.shape != (len(units), 384) or not np.isfinite(vectors).all():
        raise ValueError("Atomic embedding shape or values invalid")
    config = {
        "base_version": parent["version"],
        "model": MODEL,
        "dimension": 384,
        "unit_algorithm": ATOMIC_UNIT_ALGORITHM,
        "source_count": len(sources()),
        "unit_count": len(units),
        "raw_sha256": parent["raw_sha256"],
        "source_unit_ids": [row["source_unit_id"] for row in units],
    }
    staging = Path(tempfile.mkdtemp(prefix=f".{ATOMIC_DIRECTORY}-", dir=version_path))
    try:
        index = faiss.IndexFlatIP(384)
        index.add(vectors)
        faiss.write_index(index, str(staging / "index.faiss"))
        write_json(staging / "units.json", units)
        manifest = {
            **config,
            "index_sha256": digest((staging / "index.faiss").read_bytes()),
            "units_sha256": digest((staging / "units.json").read_bytes()),
        }
        write_json(staging / "manifest.json", manifest)
        staging.replace(destination)
    except Exception:
        # The parent corpus stays untouched.  A failed staging directory is
        # deliberately left for inspection rather than deleting broad paths.
        raise
    return load_atomic_manifest(version_path)
