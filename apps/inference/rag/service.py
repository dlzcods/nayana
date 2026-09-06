"""Grounding orchestration, independent from TensorFlow and HTTP handlers."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from collections.abc import Callable

from .citations import Citation, GROUNDING_INSTRUCTION, GroundedResponse, parse_json, validate_answer
from .common import ARTIFACTS, digest, sources, write_json
from .retrieve import contextual_query, get_retriever


def evidence_payload(rows: list[dict]) -> list[dict]:
    return [{key: row[key] for key in ("id", "title", "heading", "text", "url")} for row in rows]


def answer_question(question: str, history: list[dict], topic: str, context: dict,
                    complete: Callable[[str, str], str]) -> GroundedResponse:
    retriever = get_retriever()
    if re.search(r"(arti|maksud|makna).*(persen|skor|angka|%|kemiripan)|(persen|skor|angka|%).*(arti|maksud|makna)", question, re.I):
        return GroundedResponse(
            answer="Persentase pada hasil NAYANA adalah skor keluaran model untuk kategori pola yang dibandingkan. "
                   "Angka itu bukan peluang Anda memiliki penyakit, bukan tingkat keparahan, dan tidak memastikan mata bebas dari kondisi lain. "
                   "Hasil ini digunakan sebagai bahan skrining awal; dokter spesialis mata (Sp.M) menilai kondisi melalui pemeriksaan langsung.",
            source_status="application_context", corpus_version=retriever.version)
    query = contextual_query(question, history, topic)
    evidence = retriever.search(query)
    if re.search(r"mendadak|tiba.tiba|nyeri.*hebat|sakit.*hebat|sudden|severe.*pain", question, re.I):
        urgent = retriever.search("glaucoma When to get help right away intense eye pain nausea red blurry vision", limit=2)
        evidence = list({row["id"]: row for row in urgent + evidence}.values())
    payload = {"question": question, "conversation": history[-6:],
               "screening_context": context, "evidence": evidence_payload(evidence)}
    # One bounded repair for malformed JSON/missing IDs. No silent ungrounded fallback.
    for attempt in range(2):
        text = complete(GROUNDING_INSTRUCTION + ("\nFormat JSON/ID sumber sebelumnya tidak valid. Perbaiki tanpa menambah klaim." if attempt else ""),
                        json.dumps(payload, ensure_ascii=False))
        try:
            return validate_answer(parse_json(text), evidence, retriever.version)
        except (ValueError, TypeError):
            if attempt:
                raise ValueError("Grounded answer validation failed") from None
    raise ValueError("Grounded answer validation failed")


def _cached_suggestion_path(version: str, topic: str) -> Path:
    if not re.fullmatch(r"[a-z_]+", topic):
        raise ValueError("Invalid suggestion topic")
    return ARTIFACTS / "versions" / version / "suggestions" / f"{topic}.json"


def validate_cached_suggestions(value: object, topic: str, retriever) -> list[dict]:
    if not isinstance(value, list) or len(value) != 6:
        raise ValueError("Cached suggestion pack must have six entries")
    chunks = {row["id"]: row for row in retriever.chunks}
    allowed_urls = {row["url"] for row in sources()}
    seen_ids, seen_questions = set(), set()
    result = []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("Cached suggestion entry must be an object")
        question = item.get("question", "").strip()
        slug = item.get("id", "")
        answer = item.get("answer", "")
        citations = [Citation.model_validate(row) for row in item.get("citations", [])]
        markers = {int(row) for row in re.findall(r"\[(\d+)\]", answer)}
        citation_ids = {row.id for row in citations}
        if (not re.fullmatch(r"[a-z0-9-]{3,64}", slug) or slug in seen_ids
                or not 12 <= len(question) <= 180 or question.casefold() in seen_questions
                or item.get("source_status") != "grounded" or item.get("corpus_version") != retriever.version
                or not citations or markers != citation_ids):
            raise ValueError("Cached suggestion metadata invalid")
        for citation in citations:
            source = chunks.get(citation.chunk_id)
            if (not source or citation.corpus_version != retriever.version or citation.url not in allowed_urls
                    or citation.title != source["title"] or citation.heading != source["heading"]
                    or citation.excerpt != source["text"] or citation.url != source["url"]):
                raise ValueError("Cached suggestion provenance mismatch")
        seen_ids.add(slug); seen_questions.add(question.casefold()); result.append(item)
    return result


def load_cached_suggestions(topic: str, retriever) -> list[dict] | None:
    path = _cached_suggestion_path(retriever.version, topic)
    checksum = path.with_suffix(".sha256.json")
    if not path.is_file() or not checksum.is_file():
        return None
    raw = path.read_bytes()
    if json.loads(checksum.read_text()).get("sha256") != digest(raw):
        raise ValueError("Cached suggestion integrity check failed")
    return validate_cached_suggestions(json.loads(raw), topic, retriever)


def persist_suggestions(topic: str, questions: list[dict], retriever) -> None:
    questions = validate_cached_suggestions(questions, topic, retriever)
    path = _cached_suggestion_path(retriever.version, topic)
    write_json(path, questions)
    write_json(path.with_suffix(".sha256.json"), {"sha256": digest(path.read_bytes())})


def suggestion_pack(topic: str, context: dict, complete: Callable[[str, str], str],
                    use_cache: bool = True, persist: bool = False) -> list[dict]:
    retriever = get_retriever()
    if use_cache:
        cached = load_cached_suggestions(topic, retriever)
        if cached:
            return cached
        if os.getenv("NAYANA_RAG_REQUIRE_SEEDED_SUGGESTIONS") == "1":
            raise RuntimeError("Validated suggested-question pack is not seeded")
    # Cover educational sections, not just the disease definition. One generation
    # request produces the entire cached starter pack rather than six LLM roundtrips.
    from .retrieve import TOPIC_NAMES
    rows = {}
    for angle in ("symptoms warning signs", "causes risk factors", "examination treatment", "prevention daily eye health"):
        for row in retriever.search(TOPIC_NAMES.get(topic, "healthy vision") + " " + angle):
            rows[row["id"]] = row
    evidence = list(rows.values())
    instruction = GROUNDING_INSTRUCTION + """
TUGAS KHUSUS PAKET PEMANTIK:
Buat tepat ENAM pertanyaan Indonesia yang berbeda, relevan dengan sumber dan topik,
beserta jawaban yang sudah didukung evidence. Jangan mengulang overview/persentase.
Variasikan sudut pembahasan, gunakan pertanyaan yang wajar untuk masyarakat umum.
Gunakan "mengurangi risiko", bukan menjanjikan pencegahan atau kondisi yang pasti.
Setiap jawaban 1-2 paragraf inti ditambah batas keselamatan singkat, maksimal 1500 karakter.
Kembalikan {"questions":[{"id":"slug-unik","question":"...",
"response":{"status":"grounded","blocks":[...]}}]}. Format response mengikuti
schema blocks di atas. Semua enam jawaban harus grounded dan memiliki sumber.
"""
    payload = json.dumps({"screening_context": context, "evidence": evidence_payload(evidence)}, ensure_ascii=False)
    result = parse_json(complete(instruction, payload))
    # Gemma may return the requested six-item payload as a direct JSON array.
    # Both shapes carry the same strict item validation below.
    questions = result if isinstance(result, list) else result.get("questions", [])
    if len(questions) != 6:
        raise ValueError("Expected six grounded suggestions")
    seen = set()
    ids = set()
    output = []
    for item in questions:
        question = item["question"].strip()
        slug = item["id"]
        if not re.fullmatch(r"[a-z0-9-]{3,64}", slug) or slug in ids or question.casefold() in seen:
            raise ValueError("Invalid/duplicate suggestion")
        response = validate_answer(item["response"], evidence, retriever.version)
        if response.source_status != "grounded" or not 12 <= len(question) <= 180:
            raise ValueError("Suggestion lacks evidence")
        ids.add(slug)
        seen.add(question.casefold())
        output.append({"id": slug, "question": question, **response.model_dump()})
    if persist:
        persist_suggestions(topic, output, retriever)
    return output
