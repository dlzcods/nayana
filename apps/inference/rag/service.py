"""Grounding orchestration, independent from TensorFlow and HTTP handlers."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from collections.abc import Callable

from .citations import (Citation, DRAFT_JSON_SCHEMA, GROUNDING_INSTRUCTION, GroundedResponse,
                        LEGACY_DRAFT_JSON_SCHEMA, LEGACY_GROUNDING_INSTRUCTION,
                        SUGGESTION_ITEM_JSON_SCHEMA,
                        evidence_payload, evidence_units_from_rows, legacy_evidence_payload,
                        parse_json, validate_answer, validate_legacy_answer)
from .common import ARTIFACTS, digest, sources, write_json
from .retrieve import contextual_query, get_atomic_retriever, get_retriever


ATOMIC_CITATION_MODE = "atomic"
LEGACY_CITATION_MODE = "legacy"
# This is a release choice, not a secret or user-provided runtime setting.
# The evaluated atomic artifact is the active implementation. To roll back,
# change this one constant to LEGACY_CITATION_MODE and redeploy the API.
ACTIVE_CITATION_MODE = LEGACY_CITATION_MODE

STARTER_QUESTIONS = {
    "cataract": (
        ("cataract-overview", "Apa yang dimaksud dengan katarak?"),
        ("cataract-symptoms", "Gejala katarak apa saja yang perlu diperhatikan?"),
        ("cataract-causes", "Faktor apa yang dapat meningkatkan risiko katarak?"),
        ("cataract-exam", "Bagaimana dokter mata memeriksa katarak?"),
        ("cataract-treatment", "Bagaimana katarak biasanya ditangani?"),
        ("cataract-prevention", "Apa yang dapat dilakukan untuk membantu menjaga kesehatan mata?"),
    ),
    "diabetic_retinopathy": (
        ("dr-overview", "Apa yang dimaksud dengan retinopati diabetik?"),
        ("dr-symptoms", "Tanda retinopati diabetik apa yang perlu diperhatikan?"),
        ("dr-causes", "Bagaimana diabetes dapat memengaruhi retina?"),
        ("dr-exam", "Bagaimana dokter mata memeriksa retinopati diabetik?"),
        ("dr-treatment", "Pilihan penanganan apa yang dapat dibahas dengan dokter?"),
        ("dr-prevention", "Apa peran pengelolaan diabetes dalam menjaga kesehatan mata?"),
    ),
    "glaucoma": (
        ("glaucoma-overview", "Apa yang dimaksud dengan glaukoma?"),
        ("glaucoma-symptoms", "Gejala glaukoma apa yang perlu diperhatikan?"),
        ("glaucoma-risk", "Siapa yang dapat memiliki risiko glaukoma lebih tinggi?"),
        ("glaucoma-exam", "Bagaimana dokter mata memeriksa glaukoma?"),
        ("glaucoma-treatment", "Bagaimana glaukoma biasanya ditangani?"),
        ("glaucoma-urgent", "Kapan gejala mata perlu diperiksakan segera?"),
    ),
    "normal": (
        ("healthy-overview", "Apa saja langkah sederhana untuk menjaga kesehatan mata?"),
        ("healthy-screen", "Bagaimana menjaga mata saat memakai layar dalam waktu lama?"),
        ("healthy-sun", "Bagaimana melindungi mata dari sinar matahari?"),
        ("healthy-protection", "Kapan kacamata pelindung perlu digunakan?"),
        ("healthy-lifestyle", "Kebiasaan sehari-hari apa yang dapat mendukung kesehatan mata?"),
        ("healthy-exam", "Kapan sebaiknya menjalani pemeriksaan mata?"),
    ),
}


def citation_mode() -> str:
    mode = ACTIVE_CITATION_MODE
    if mode not in {LEGACY_CITATION_MODE, ATOMIC_CITATION_MODE}:
        raise RuntimeError("ACTIVE_CITATION_MODE must be legacy or atomic")
    return mode


def atomic_starter_questions(topic: str) -> list[dict]:
    """Return navigation prompts only; they are never medical answers."""
    try:
        return [{"id": identifier, "question": question} for identifier, question in STARTER_QUESTIONS[topic]]
    except KeyError as error:
        raise ValueError("Unsupported atomic starter topic") from error


def answer_question(question: str, history: list[dict], topic: str, context: dict,
                    complete: Callable[[str, str, dict], str],
                    claim_verifier: Callable[[list[tuple[str, str]]], list[bool]] | None = None) -> GroundedResponse:
    mode = citation_mode()
    if re.search(r"(arti|maksud|makna).*(persen|skor|angka|%|kemiripan)|(persen|skor|angka|%).*(arti|maksud|makna)", question, re.I):
        return GroundedResponse(
            answer="Persentase pada hasil NAYANA adalah skor keluaran model untuk kategori pola yang dibandingkan. "
                   "Angka itu bukan peluang Anda memiliki penyakit, bukan tingkat keparahan, dan tidak memastikan mata bebas dari kondisi lain. "
                   "Hasil ini digunakan sebagai bahan skrining awal; dokter spesialis mata (Sp.M) menilai kondisi melalui pemeriksaan langsung.",
            source_status="application_context", corpus_version=None)
    retriever = get_atomic_retriever() if mode == ATOMIC_CITATION_MODE else get_retriever()
    query = contextual_query(question, history, topic)
    evidence = retriever.search(query, limit=3 if mode == ATOMIC_CITATION_MODE else 4)
    if re.search(r"mendadak|tiba.tiba|nyeri.*hebat|sakit.*hebat|sudden|severe.*pain", question, re.I):
        urgent = retriever.search("glaucoma When to get help right away intense eye pain nausea red blurry vision", limit=2)
        evidence = list({row["id"]: row for row in urgent + evidence}.values())
    if not evidence:
        return GroundedResponse(answer="Sumber NEI yang tersedia belum cukup untuk menjawab pertanyaan tersebut secara spesifik.",
                                source_status="insufficient_evidence", corpus_version=retriever.version)

    if mode == LEGACY_CITATION_MODE:
        payload = {"question": question, "conversation": history[-6:],
                   "screening_context": context, "evidence": legacy_evidence_payload(evidence)}
        text = complete(LEGACY_GROUNDING_INSTRUCTION, json.dumps(payload, ensure_ascii=False), LEGACY_DRAFT_JSON_SCHEMA)
        return validate_legacy_answer(parse_json(text), evidence, retriever.version)

    units = evidence_units_from_rows(evidence)
    payload = {"question": question, "conversation": history[-6:],
               "screening_context": context, "evidence_units": evidence_payload(units)}
    # Exactly one generative request. A schema or grounding failure becomes an
    # honest insufficient-evidence response, never a slow retry or guessed quote.
    text = complete(GROUNDING_INSTRUCTION, json.dumps(payload, ensure_ascii=False), DRAFT_JSON_SCHEMA)
    try:
        verifier = claim_verifier
        if verifier is None:
            from .verify import get_claim_verifier
            verifier = get_claim_verifier().verify
        return validate_answer(parse_json(text), units, retriever.version, claim_verifier=verifier)
    except (ValueError, TypeError):
        return GroundedResponse(answer="Sumber NEI yang tersedia belum cukup untuk menjawab pertanyaan tersebut secara spesifik. "
                                "Untuk penilaian kondisi pribadi, diskusikan dengan dokter spesialis mata (Sp.M).",
                                source_status="insufficient_evidence", corpus_version=retriever.version)


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
        markers = {int(row) for row in re.findall(r"\[(\d+)(?::\d+)?\]", answer)}
        citation_ids = {row.id for row in citations}
        if (not re.fullmatch(r"[a-z0-9-]{3,64}", slug) or slug in seen_ids
                or not 12 <= len(question) <= 180 or question.casefold() in seen_questions
                or item.get("source_status") != "grounded" or item.get("corpus_version") != retriever.version
                or not citations or markers != citation_ids):
            raise ValueError("Cached suggestion metadata invalid")
        for citation in citations:
            source = chunks.get(citation.chunk_id)
            # A readable article-level citation can contain claims from several
            # retrieved chunks/headings of that *same* NEI article. Validate
            # every claim against the complete set of that article's atomic
            # units, never only the first chunk stored on Citation.chunk_id.
            article_rows = [
                {**row, "corpus_version": retriever.version}
                for row in chunks.values()
                if row["url"] == citation.url and row["title"] == citation.title
            ]
            source_units = evidence_units_from_rows(article_rows)
            allowed_excerpts = {unit["text"] for unit in source_units}
            allowed_claims = {(unit["heading"], unit["text"]) for unit in source_units}
            if (not source or citation.corpus_version != retriever.version or citation.url not in allowed_urls
                    or citation.title != source["title"] or citation.heading != source["heading"]
                    or citation.excerpt not in allowed_excerpts or citation.url != source["url"]):
                raise ValueError(f"Cached suggestion provenance mismatch: citation={citation.id}")
            for claim in citation.claims:
                # New packs carry an exact chunk ID.  Older valid packs lack it,
                # so retain the article-wide compatibility check for them only.
                if claim.source_chunk_id:
                    claim_row = chunks.get(claim.source_chunk_id)
                    claim_units = evidence_units_from_rows(
                        [{**claim_row, "corpus_version": retriever.version}]
                    ) if claim_row else []
                    is_valid = bool(claim_row and claim_row["url"] == citation.url and
                                    (claim.heading, claim.excerpt) in {
                                        (unit["heading"], unit["text"]) for unit in claim_units
                                    })
                else:
                    is_valid = (claim.heading, claim.excerpt) in allowed_claims
                if not is_valid:
                    raise ValueError(
                        f"Cached suggestion provenance mismatch: citation={citation.id} "
                        f"claim_chunk={claim.source_chunk_id or 'legacy'}"
                    )
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


def suggestion_pack(topic: str, context: dict, complete: Callable[[str, str, dict | None], str],
                    use_cache: bool = True, persist: bool = False,
                    checkpoint_commit: Callable[[], None] | None = None) -> list[dict]:
    retriever = get_retriever()
    if use_cache:
        try:
            cached = load_cached_suggestions(topic, retriever)
        except ValueError:
            # A normal request must never serve unverifiable cached provenance.
            # The explicit offline seed path is the one authorised place to
            # replace such a legacy/invalid artifact with a newly validated pack.
            if not persist:
                raise
            cached = None
        if cached:
            return cached
        if not persist and os.getenv("NAYANA_RAG_REQUIRE_SEEDED_SUGGESTIONS") == "1":
            raise RuntimeError("Validated suggested-question pack is not seeded")
    # Build the pack from six small, independently structured RAG generations.
    # A single large six-answer JSON has repeatedly been truncated or malformed
    # by the provider; atomic requests are validated before anything is persisted.
    from .retrieve import TOPIC_NAMES
    angles = (
        "pengertian atau gambaran umum yang paling relevan",
        "gejala atau tanda yang patut diperhatikan",
        "penyebab atau faktor risiko",
        "cara pemeriksaan oleh dokter mata",
        "pilihan penanganan atau langkah setelah pemeriksaan",
        "pencegahan atau kebiasaan sehari-hari yang sesuai sumber",
    )
    seen = set()
    ids = set()
    output = []
    for index, angle in enumerate(angles, start=1):
        evidence = retriever.search(f"{TOPIC_NAMES.get(topic, 'healthy vision')} {angle}")
        units = evidence_units_from_rows(evidence)
        if not units:
            raise ValueError(f"No evidence available for suggestion {index}")
        instruction = GROUNDING_INSTRUCTION + f"""
TUGAS KHUSUS PEMANTIK {index}/6:
Buat SATU pertanyaan Indonesia yang wajar tentang {angle}, beserta jawaban edukatif
berdasarkan evidence_units. Jangan mengulang overview atau skor skrining. Gunakan
"mengurangi risiko", bukan janji pencegahan atau kepastian kondisi.
Jawaban maksimal 550 karakter: satu evidence block dengan 2-3 claim pendek dan satu
limitation singkat. Pada evidence block, text harus string kosong dan jawaban hanya
ada pada claims. Kembalikan tepat satu objek JSON {{"id":"slug-unik","question":"...",
"response":{{"status":"grounded","blocks":[...]}}}}.
"""
        payload = json.dumps({"screening_context": context, "evidence_units": evidence_payload(units)}, ensure_ascii=False)
        checkpoint = _cached_suggestion_path(retriever.version, topic).parent / "checkpoints" / topic / f"{index}.json"
        fingerprint = digest(json.dumps([instruction, payload, SUGGESTION_ITEM_JSON_SCHEMA], sort_keys=True))
        item = None
        if persist and checkpoint.is_file():
            saved = json.loads(checkpoint.read_text())
            if saved.get("fingerprint") == fingerprint:
                item = saved["item"]
        if item is None:
            item = parse_json(complete(instruction, payload, SUGGESTION_ITEM_JSON_SCHEMA))
        if not isinstance(item, dict):
            raise ValueError(f"Suggestion {index} must be an object")
        question = item["question"].strip()
        slug = item["id"]
        if not re.fullmatch(r"[a-z0-9-]{3,64}", slug) or slug in ids or question.casefold() in seen:
            raise ValueError("Invalid/duplicate suggestion")
        # Suggestions are built offline. They still use server-owned units, but
        # no live NLI model is needed when a pack is later served to a user.
        response = validate_answer(item["response"], units, retriever.version)
        if response.source_status != "grounded" or not 12 <= len(question) <= 180:
            raise ValueError("Suggestion lacks evidence")
        ids.add(slug)
        seen.add(question.casefold())
        output.append({"id": slug, "question": question, **response.model_dump()})
        if persist:
            # Checkpoints are private build artifacts, never served as a pack.
            # Revalidate their evidence and uniqueness on every resume.
            write_json(checkpoint, {"fingerprint": fingerprint, "item": item})
            if checkpoint_commit:
                checkpoint_commit()
    if persist:
        persist_suggestions(topic, output, retriever)
    return output
