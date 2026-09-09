from __future__ import annotations

import json
import os
from pathlib import Path
import re
import threading
from collections import Counter
from math import log

from .common import ARTIFACTS
from .index import load_manifest

TOPIC_NAMES = {"cataract": "cataracts katarak", "diabetic_retinopathy": "diabetic retinopathy retinopati diabetik",
               "glaucoma": "glaucoma glaukoma", "normal": "eye health healthy vision"}
TOPIC_PATTERNS = {"cataract": r"katar[ae]k|cataract", "diabetic_retinopathy": r"retinopat|retinopath|diabet",
                  "glaucoma": r"gl[au]+[ck]om"}
TOPIC_SOURCE_IDS = {
    "cataract": {"cataracts"},
    "diabetic_retinopathy": {"diabetic-retinopathy"},
    "glaucoma": {"glaucoma"},
}
INTENT_EXPANSIONS = (
    (r"periksa|memeriksa|pemeriksaan|diperiksa|cek|tes|deteksi", "eye exam comprehensive dilated eye exam diagnosis testing"),
    (r"penyebab|sebab|kenapa|risiko", "causes risk factors"),
    (r"gejala|ciri|tanda|terasa", "symptoms signs"),
    (r"obat|terapi|operasi|ditangani|sembuh", "treatment medicines surgery"),
    (r"cegah|mencegah|menjaga|lindungi", "prevention protect healthy vision"),
)
HEADING_INTENTS = (
    # These expressions deliberately describe the *question intent* and NEI's
    # source headings separately.  A sentence embedding alone is not reliable
    # enough to route "Apa itu ...?" to an overview rather than a risk sentence.
    (r"apa itu|apa yang dimaksud|pengertian|gambaran",
     r"^(?:what (?:is|are) (?!the (?:types|symptoms)|causes)|at a glance|overview)"),
    (r"periksa|memeriksa|pemeriksaan|diperiksa|cek|tes|deteksi", r"exam|diagnos|test|check"),
    (r"risiko|berisiko", r"risk"),
    (r"penyebab|sebab|kenapa", r"cause"),
    (r"gejala|ciri|tanda|terasa|berasa|awal", r"symptom|sign"),
    (r"obat|terapi|operasi|ditangani|penanganan|pilihan.*tangan|sembuh", r"treat|medicine|surgery"),
    (r"cegah|mencegah|menjaga|lindungi", r"prevent|protect|healthy"),
)


def expand_intent(query: str, question: str) -> str:
    additions = [terms for pattern, terms in INTENT_EXPANSIONS if re.search(pattern, question, re.I)]
    return query + (("\nIntent: " + " ".join(additions)) if additions else "")


def explicit_topics(query: str) -> tuple[str, ...]:
    """Return only diseases named in the newest query, in a stable order.

    This is deliberately a source guard, not a diagnostic inference from the
    screening label. A general question is allowed to search the full corpus.
    """
    return tuple(key for key, pattern in TOPIC_PATTERNS.items() if re.search(pattern, query, re.I))


def allowed_source_ids(query: str) -> set[str] | None:
    topics = explicit_topics(query)
    if not topics:
        return None
    return set().union(*(TOPIC_SOURCE_IDS[topic] for topic in topics))


def _terms(text: str) -> list[str]:
    return re.findall(r"[a-zA-ZÀ-ÿ0-9]{2,}", text.lower())


class TinyBM25:
    """Small in-memory BM25 index for the immutable five-article corpus."""
    def __init__(self, rows: list[dict]):
        self.documents = [_terms(" ".join(str(row.get(key, "")) for key in ("title", "heading", "text")))
                          for row in rows]
        self.lengths = [len(document) for document in self.documents]
        self.average_length = sum(self.lengths) / max(1, len(self.lengths))
        document_frequency: Counter[str] = Counter()
        for document in self.documents:
            document_frequency.update(set(document))
        count = len(self.documents)
        self.idf = {term: log(1 + (count - frequency + .5) / (frequency + .5))
                    for term, frequency in document_frequency.items()}

    def rank(self, query: str) -> list[tuple[float, int]]:
        query_terms = set(_terms(query))
        scored: list[tuple[float, int]] = []
        for index, document in enumerate(self.documents):
            frequencies = Counter(document)
            denominator_base = 1.2 * (1 - .75 + .75 * self.lengths[index] / max(1, self.average_length))
            score = sum(self.idf.get(term, 0.0) * frequencies[term] * 2.2 /
                        (frequencies[term] + denominator_base) for term in query_terms)
            scored.append((score, index))
        return sorted(scored, key=lambda item: (-item[0], item[1]))


MEMORY_INTENT_TERMS = {
    "overview": "what is overview", "symptoms": "symptoms signs", "risk": "risk factors",
    "causes": "causes", "examination": "eye exam diagnosis testing", "treatment": "treatment medicines surgery",
    "prevention": "prevention protect healthy vision", "urgent": "when to get help right away urgent",
}


def contextual_query(question: str, history: list[dict], topic: str, memory_intent: str | None = None) -> str:
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
        # New browser memory never sends prior prose. It supplies only a
        # deterministic intent label derived locally from the last user turn.
        if memory_intent in MEMORY_INTENT_TERMS:
            query += "\nPrevious conversation intent: " + MEMORY_INTENT_TERMS[memory_intent]
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
        self.bm25 = TinyBM25(self.chunks)
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
        # The corpus is intentionally tiny (44 chunks). Search all rows before
        # applying a named-condition guard; a top-20 pre-cut can otherwise
        # discard the correct condition before fusion has a chance to rank it.
        scores, indices = self.index.search(np.asarray(vector, dtype="float32"), len(self.chunks))
        intents = [heading for pattern, heading in HEADING_INTENTS if re.search(pattern, query, re.I)]
        permitted = allowed_source_ids(query)

        dense_candidates = [int(index) for index in indices[0] if index >= 0
                            and (permitted is None or self.chunks[int(index)]["source_id"] in permitted)]
        lexical_candidates = [index for _score, index in self.bm25.rank(query)
                              if permitted is None or self.chunks[index]["source_id"] in permitted]
        # Rank after guarding. A named disease must not be penalised merely
        # because rows from an ineligible disease occupied earlier ranks.
        dense_rank = {index: rank for rank, index in enumerate(dense_candidates, start=1)}
        lexical_rank = {index: rank for rank, index in enumerate(lexical_candidates, start=1)}
        # Reciprocal-rank fusion keeps both retrieval signals ordinal. It avoids
        # pretending vector cosine and BM25 values have a common numeric scale.
        candidates = set(dense_rank) | set(lexical_rank)
        ranked = []
        for index in candidates:
            heading = self.chunks[index]["heading"]
            heading_match = any(re.search(pattern, heading, re.I) for pattern in intents)
            fusion = (1 / (60 + dense_rank[index]) if index in dense_rank else 0) + \
                     (1 / (60 + lexical_rank[index]) if index in lexical_rank else 0)
            ranked.append((fusion, heading_match, dense_rank.get(index, len(self.chunks) + 1), index))
        ranked.sort(key=lambda item: (-item[0], not item[1], item[2], item[3]))
        selected = []
        for fusion, _heading_match, _dense_rank, index in ranked:
            row = self.chunks[int(index)]
            # Avoid spending the context budget on heavily overlapping windows.
            duplicate = any(old["source_id"] == row["source_id"] and old["heading"] == row["heading"]
                            and max(0, min(old["end"], row["end"]) - max(old["start"], row["start"]))
                            > .6 * min(old["end"] - old["start"], row["end"] - row["start"]) for old in selected)
            if not duplicate:
                selected.append({**row, "score": float(fusion), "corpus_version": self.version,
                                 "retrieval": {"method": "e5_bm25_rrf",
                                               "topic_guard": sorted(permitted) if permitted else [],
                                               "dense_rank": dense_rank.get(index),
                                               "lexical_rank": lexical_rank.get(index)}})
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
