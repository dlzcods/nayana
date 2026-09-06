from __future__ import annotations

import json
import os
from pathlib import Path
import re
import threading

from .common import ARTIFACTS
from .index import load_manifest

TOPIC_NAMES = {"cataract": "cataracts katarak", "diabetic_retinopathy": "diabetic retinopathy retinopati diabetik",
               "glaucoma": "glaucoma glaukoma", "normal": "eye health healthy vision"}
TOPIC_PATTERNS = {"cataract": r"katar[ae]k|cataract", "diabetic_retinopathy": r"retinopat|retinopath|diabet",
                  "glaucoma": r"gl[au]+[ck]om"}
INTENT_EXPANSIONS = (
    (r"periksa|pemeriksaan|diperiksa|cek|tes|deteksi", "eye exam comprehensive dilated eye exam diagnosis testing"),
    (r"penyebab|sebab|kenapa|risiko", "causes risk factors"),
    (r"gejala|ciri|tanda|terasa", "symptoms signs"),
    (r"obat|terapi|operasi|ditangani|sembuh", "treatment medicines surgery"),
    (r"cegah|mencegah|menjaga|lindungi", "prevention protect healthy vision"),
)
HEADING_INTENTS = (
    (r"periksa|pemeriksaan|diperiksa|cek|tes|deteksi", r"exam|diagnos|test|check"),
    (r"risiko|berisiko", r"risk"),
    (r"penyebab|sebab|kenapa", r"cause"),
    (r"gejala|ciri|tanda|terasa", r"symptom|sign|help right away"),
    (r"obat|terapi|operasi|ditangani|sembuh", r"treat|medicine|surgery"),
    (r"cegah|mencegah|menjaga|lindungi", r"prevent|protect|healthy"),
)


def expand_intent(query: str, question: str) -> str:
    additions = [terms for pattern, terms in INTENT_EXPANSIONS if re.search(pattern, question, re.I)]
    return query + (("\nIntent: " + " ".join(additions)) if additions else "")


def contextual_query(question: str, history: list[dict], topic: str) -> str:
    """Bounded conversation context; never add an inferred personal condition."""
    query = question.strip()
    explicit = [key for key, pattern in TOPIC_PATTERNS.items() if re.search(pattern, query, re.I)]
    if explicit:
        return expand_intent(query + "\nTopic: " + ", ".join(TOPIC_NAMES[key] for key in explicit), question)
    # Only resolve genuinely short/deictic follow-ups. Do not pollute an explicit
    # general-health question with the screening label or an old assistant answer.
    followup = len(query.split()) <= 5 or bool(re.search(r"\b(itu|tersebut|tadi|nya)\b", query, re.I))
    general = bool(re.search(r"jaga|menjaga|sehat|lindung|layar|komputer|makan|sunglass|healthy", query, re.I))
    if followup and not general:
        previous = next((row["content"] for row in reversed(history) if row["role"] == "user"), "")
        previous_topics = [key for key, pattern in TOPIC_PATTERNS.items() if re.search(pattern, previous, re.I)]
        context = ", ".join(TOPIC_NAMES[key] for key in previous_topics) if previous_topics else TOPIC_NAMES.get(topic, "eye health")
        query += "\nTopic being discussed: " + context
        if previous:
            query += "\nPrevious question: " + previous[:300]
    return expand_intent(query, question)


class Retriever:
    def __init__(self, path: Path):
        import faiss
        from sentence_transformers import SentenceTransformer
        self.manifest = load_manifest(path)
        self.version = self.manifest["version"]
        self.chunks = json.loads((path / "chunks.json").read_text())
        self.index = faiss.read_index(str(path / "index.faiss"))
        if self.index.d != 384 or self.index.ntotal != len(self.chunks):
            raise ValueError("Index/chunk mismatch")
        self.encoder = SentenceTransformer(str(path / "encoder"), device="cpu", local_files_only=True)
        self.encoder.max_seq_length = 512
        self.lock = threading.Lock()

    def search(self, query: str, limit: int = 4) -> list[dict]:
        import numpy as np
        # Query truncation is explicit and bounded; document chunks are never truncated.
        tokens = self.encoder.tokenizer.encode("query: " + query, add_special_tokens=False)
        if len(tokens) > 500:
            query = self.encoder.tokenizer.decode(tokens[:500], skip_special_tokens=True)
        else:
            query = "query: " + query
        with self.lock:
            vector = self.encoder.encode([query], normalize_embeddings=True, show_progress_bar=False)
        scores, indices = self.index.search(np.asarray(vector, dtype="float32"), min(20, len(self.chunks)))
        intents = [heading for pattern, heading in HEADING_INTENTS if re.search(pattern, query, re.I)]
        ranked = []
        for score, index in zip(scores[0], indices[0]):
            if index < 0:
                continue
            heading = self.chunks[int(index)]["heading"]
            boost = .08 if any(re.search(pattern, heading, re.I) for pattern in intents) else 0
            ranked.append((float(score) + boost, score, index))
        ranked.sort(reverse=True, key=lambda item: item[0])
        selected = []
        for _, score, index in ranked:
            row = self.chunks[int(index)]
            # Avoid spending the context budget on heavily overlapping windows.
            duplicate = any(old["source_id"] == row["source_id"] and old["heading"] == row["heading"]
                            and max(0, min(old["end"], row["end"]) - max(old["start"], row["start"]))
                            > .6 * min(old["end"] - old["start"], row["end"] - row["start"]) for old in selected)
            if not duplicate:
                selected.append({**row, "score": float(score), "corpus_version": self.version})
            if len(selected) == limit:
                break
        return selected


_retriever: Retriever | None = None
_load_lock = threading.Lock()


def get_retriever() -> Retriever:
    global _retriever
    with _load_lock:
        if _retriever is None:
            version = os.getenv("NAYANA_RAG_VERSION", "").strip()
            if not re.fullmatch(r"nei-[a-f0-9]{16}", version):
                raise RuntimeError("Set a tested NAYANA_RAG_VERSION before enabling RAG")
            _retriever = Retriever(ARTIFACTS / "versions" / version)
    return _retriever
