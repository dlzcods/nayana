"""Hybrid-retrieval NEI grounding with server-owned sentence citations."""
from __future__ import annotations

import json
import re
from collections.abc import Callable

from .citations import (ANSWER_JSON_SCHEMA, GROUNDING_INSTRUCTION, STREAMING_GROUNDING_INSTRUCTION,
                        Citation, GroundedResponse, attribute_answer, attribute_verified_sentence,
                        evidence_payload, parse_answer)
from .retrieve import contextual_query, get_retriever
from .telemetry import retrieval_metadata, scoped_trace


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


def starter_questions(topic: str) -> list[dict]:
    try:
        return [{"id": identifier, "question": question} for identifier, question in STARTER_QUESTIONS[topic]]
    except KeyError as error:
        raise ValueError("Unsupported starter topic") from error


def answer_question(question: str, history: list[dict], topic: str, context: dict,
                    complete: Callable[[str, str, dict], str], memory_intent: str | None = None) -> GroundedResponse:
    retriever = get_retriever()
    if re.search(r"(arti|maksud|makna).*(persen|skor|angka|%|kemiripan)|(persen|skor|angka|%).*(arti|maksud|makna)", question, re.I):
        return GroundedResponse(
            answer="Persentase pada hasil NAYANA adalah skor keluaran model untuk kategori pola yang dibandingkan. "
                   "Angka itu bukan peluang Anda memiliki penyakit, bukan tingkat keparahan, dan tidak memastikan mata bebas dari kondisi lain. "
                   "Hasil ini digunakan sebagai bahan skrining awal; dokter spesialis mata (Sp.M) menilai kondisi melalui pemeriksaan langsung.",
            source_status="application_context", corpus_version=retriever.version,
        )
    query = contextual_query(question, history, topic, memory_intent=memory_intent)
    evidence = retriever.search(query)
    if re.search(r"mendadak|tiba.tiba|nyeri.*hebat|sakit.*hebat|sudden|severe.*pain", question, re.I):
        urgent = retriever.search("glaucoma When to get help right away intense eye pain nausea red blurry vision", limit=2)
        evidence = list({row["id"]: row for row in urgent + evidence}.values())[:4]
    if not evidence:
        return GroundedResponse(
            answer="Sumber NEI yang tersedia belum cukup untuk menjawab pertanyaan tersebut secara spesifik.",
            source_status="insufficient_evidence", corpus_version=retriever.version,
        )
    # History has already been reduced to one previous user question for
    # retrieval. Never replay browser chat bubbles to the provider.
    # build_summary_context already owns this envelope. Flatten it before the
    # provider sees it so the documented `screening_context.categories` path is
    # real rather than accidentally becoming `screening_context.screening_context`.
    screening_context = context.get("screening_context", context)
    payload = {"question": question, "screening_context": screening_context,
               "evidence": evidence_payload(evidence)}
    payload_text = json.dumps(payload, ensure_ascii=False)
    metadata = retrieval_metadata(question=question, query=query, payload=payload_text,
                                  evidence=evidence, memory_intent=memory_intent,
                                  instruction=GROUNDING_INSTRUCTION)
    import logging
    # Modal's default log view suppresses INFO records; WARNING keeps successful requests visible with failures.
    logging.getLogger(__name__).warning("NEI RAG retrieval trace=%s", metadata)
    # One provider call: prose only. Citation identity, markers, and exact
    # quote selection are server-owned after the model returns its answer.
    with scoped_trace(metadata):
        text = complete(GROUNDING_INSTRUCTION, payload_text, ANSWER_JSON_SCHEMA)
    return attribute_answer(parse_answer(text), evidence, retriever.version,
                            encoder=getattr(retriever, "encoder", None))


def _complete_sentences(fragments):
    """Yield only completed prose sentences from a provider fragment stream."""
    buffer = ""
    substitutions = {
        "Sp.M.": "Sp§M§", "dr.": "dr§", "Dr.": "Dr§", "dll.": "dll§", "dsb.": "dsb§",
    }
    for fragment in fragments:
        if not fragment:
            continue
        buffer += fragment
        protected = buffer
        for original, replacement in substitutions.items():
            protected = protected.replace(original, replacement)
        matches = list(re.finditer(r".+?[.!?](?=\s+)", protected, flags=re.DOTALL))
        consumed = 0
        for match in matches:
            protected_sentence = match.group(0).strip()
            sentence = protected_sentence
            for original, replacement in substitutions.items():
                sentence = sentence.replace(replacement, original)
            consumed = match.end()
            if sentence:
                yield sentence
        if consumed:
            buffer = protected[consumed:]
            for original, replacement in substitutions.items():
                buffer = buffer.replace(replacement, original)

    trailing = buffer.strip()
    if trailing and re.search(r"[.!?]$", trailing):
        yield trailing


def stream_answer_question(question: str, history: list[dict], topic: str, context: dict,
                           stream_complete: Callable[[str, str], object],
                           memory_intent: str | None = None):
    """Yield verified chat events without exposing provider fragments to callers."""
    question = question.strip()
    if not question:
        raise ValueError("Pertanyaan tidak boleh kosong.")

    yield "status", {"stage": "retrieving"}
    retriever = get_retriever()
    score_question = re.search(
        r"(arti|maksud|makna).*(persen|skor|angka|%|kemiripan)|(persen|skor|angka|%).*(arti|maksud|makna)",
        question, re.I,
    )
    if score_question:
        response = answer_question(question, history, topic, context,
                                   lambda *_args: (_ for _ in ()).throw(ValueError("Provider tidak diperlukan.")),
                                   memory_intent=memory_intent)
        for sentence in _complete_sentences([response.answer]):
            yield "sentence", {
                "text": sentence,
                "citations": [],
                "source_status": response.source_status,
                "corpus_version": response.corpus_version,
            }
        yield "complete", response.model_dump()
        return

    query = contextual_query(question, history, topic, memory_intent=memory_intent)
    evidence = retriever.search(query)
    if re.search(r"mendadak|tiba.tiba|nyeri.*hebat|sakit.*hebat|sudden|severe.*pain", question, re.I):
        urgent = retriever.search("glaucoma When to get help right away intense eye pain nausea red blurry vision", limit=2)
        evidence = list({row["id"]: row for row in urgent + evidence}.values())[:4]
    if not evidence:
        response = GroundedResponse(
            answer="Sumber NEI yang tersedia belum cukup untuk menjawab pertanyaan tersebut secara spesifik.",
            source_status="insufficient_evidence", corpus_version=retriever.version,
        )
        yield "complete", response.model_dump()
        return

    screening_context = context.get("screening_context", context)
    payload = {"question": question, "screening_context": screening_context, "evidence": evidence_payload(evidence)}
    payload_text = json.dumps(payload, ensure_ascii=False)
    metadata = retrieval_metadata(question=question, query=query, payload=payload_text,
                                  evidence=evidence, memory_intent=memory_intent,
                                  instruction=STREAMING_GROUNDING_INSTRUCTION)
    import logging
    logging.getLogger(__name__).warning("NEI RAG streaming retrieval trace=%s", metadata)

    yield "status", {"stage": "generating"}
    citations_by_url: dict[str, Citation] = {}
    emitted = 0
    # Starlette advances a synchronous StreamingResponse generator in separate
    # copied contexts. A ContextVar token cannot safely span those yields, and
    # resetting it after the final sentence can turn a valid answer into a
    # terminal SSE error. Stream adapters do not consume ``current_trace``;
    # the safe retrieval metadata has already been recorded above.
    for candidate in _complete_sentences(stream_complete(STREAMING_GROUNDING_INSTRUCTION, payload_text)):
        yield "status", {"stage": "attributing"}
        rendered, citations = attribute_verified_sentence(
            candidate, evidence, retriever.version, citations_by_url=citations_by_url,
            encoder=getattr(retriever, "encoder", None),
        )
        if not rendered:
            continue
        emitted += 1
        yield "sentence", {
            "text": rendered,
            "citations": [citation.model_dump() for citation in citations],
            "source_status": "grounded",
            "corpus_version": retriever.version,
        }

    if not emitted:
        yield "error", {
            "code": "INSUFFICIENT_EVIDENCE",
            "message": "Sumber NEI yang tersedia belum cukup untuk menampilkan jawaban yang dapat diverifikasi.",
        }
        return
    yield "complete", {
        "source_status": "grounded",
        "corpus_version": retriever.version,
        "citations": [citation.model_dump() for citation in citations_by_url.values()],
    }
