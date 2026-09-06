"""Build a small exact-search index and publish only complete, checked versions."""
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
from importlib.metadata import version as package_version

from .common import ARTIFACTS, MODEL, digest, sources, write_json


def tree_digest(path: Path) -> str:
    """Stable integrity digest for all files in a saved local encoder."""
    value = b""
    for item in sorted(row for row in path.rglob("*") if row.is_file()):
        value += str(item.relative_to(path)).encode() + b"\0" + bytes.fromhex(digest(item.read_bytes()))
    return digest(value)


def build() -> dict:
    import faiss
    import numpy as np
    from sentence_transformers import SentenceTransformer
    from huggingface_hub import model_info
    from .prepare import prepare

    revision = os.getenv("NAYANA_EMBEDDING_REVISION") or model_info(MODEL).sha
    encoder = SentenceTransformer(MODEL, revision=revision, device="cpu")
    encoder.max_seq_length = 512
    chunks = prepare(encoder.tokenizer)
    vectors = encoder.encode([row["embedding_text"] for row in chunks],
                             normalize_embeddings=True, show_progress_bar=False)
    vectors = np.ascontiguousarray(vectors, dtype="float32")
    if vectors.shape != (len(chunks), 384) or not np.isfinite(vectors).all():
        raise ValueError("Embedding shape or values invalid")
    raw_hashes = {row["id"]: json.loads((ARTIFACTS / "raw" / f"{row['id']}.json").read_text())["raw_sha256"]
                  for row in sources()}
    config = {"model": MODEL, "revision": revision, "dimension": 384,
              "chunk_chars": 1500, "overlap_chars": 300, "max_tokens": 512,
              "transformers_version": package_version("transformers"),
              "sentence_transformers_version": package_version("sentence-transformers"),
              "raw_sha256": raw_hashes,
              "chunk_ids": [row["id"] for row in chunks]}
    version = "nei-" + digest(json.dumps(config, sort_keys=True))[:16]
    destination = ARTIFACTS / "versions" / version
    if destination.exists():
        existing = load_manifest(destination)
        if all(existing.get(key) == value for key, value in config.items()):
            return existing
        raise ValueError("Immutable RAG version already exists with different content")
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{version}-", dir=destination.parent))
    # Save weights with the index: serving never needs an unpinned model download.
    encoder.save(str(staging / "encoder"))
    index = faiss.IndexFlatIP(384)
    index.add(vectors)
    faiss.write_index(index, str(staging / "index.faiss"))
    write_json(staging / "chunks.json", chunks)
    manifest = {**config, "version": version, "source_count": len(sources()),
                "chunk_count": len(chunks), "encoder_sha256": tree_digest(staging / "encoder"),
                "index_sha256": digest((staging / "index.faiss").read_bytes()),
                "chunks_sha256": digest((staging / "chunks.json").read_bytes())}
    write_json(staging / "manifest.json", manifest)
    staging.replace(destination)
    # This candidate is not enabled in production by the build job.
    write_json(ARTIFACTS / "candidate.json", {"version": version})
    return manifest


def load_manifest(path: Path) -> dict:
    manifest = json.loads((path / "manifest.json").read_text())
    if manifest["model"] != MODEL or manifest["dimension"] != 384:
        raise ValueError("Unexpected embedding model")
    for filename, field in (("index.faiss", "index_sha256"), ("chunks.json", "chunks_sha256")):
        if digest((path / filename).read_bytes()) != manifest[field]:
            raise ValueError("RAG artifact integrity check failed")
    if "encoder_sha256" in manifest and tree_digest(path / "encoder") != manifest["encoder_sha256"]:
        raise ValueError("RAG encoder integrity check failed")
    return manifest
