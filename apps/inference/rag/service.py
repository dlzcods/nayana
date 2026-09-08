"""Legacy paragraph-level NEI grounding orchestration."""
from __future__ import annotations

import json
import re
from collections.abc import Callable

from .citations import DRAFT_JSON_SCHEMA, GROUNDING_INSTRUCTION, GroundedResponse, evidence_payload, parse_json, validate_answer
from .retrieve import contextual_query, get_retriever


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
                    complete: Callable[[str, str, dict], str]) -> GroundedResponse:
    retriever = get_retriever()
    if re.search(r"(arti|maksud|makna).*(persen|skor|angka|%|kemiripan)|(persen|skor|angka|%).*(arti|maksud|makna)", question, re.I):
        return GroundedResponse(
            answer="Persentase pada hasil NAYANA adalah skor keluaran model untuk kategori pola yang dibandingkan. "
                   "Angka itu bukan peluang Anda memiliki penyakit, bukan tingkat keparahan, dan tidak memastikan mata bebas dari kondisi lain. "
                   "Hasil ini digunakan sebagai bahan skrining awal; dokter spesialis mata (Sp.M) menilai kondisi melalui pemeriksaan langsung.",
            source_status="application_context", corpus_version=retriever.version,
        )
    query = contextual_query(question, history, topic)
    evidence = retriever.search(query)
    if re.search(r"mendadak|tiba.tiba|nyeri.*hebat|sakit.*hebat|sudden|severe.*pain", question, re.I):
        urgent = retriever.search("glaucoma When to get help right away intense eye pain nausea red blurry vision", limit=2)
        evidence = list({row["id"]: row for row in urgent + evidence}.values())
    if not evidence:
        return GroundedResponse(
            answer="Sumber NEI yang tersedia belum cukup untuk menjawab pertanyaan tersebut secara spesifik.",
            source_status="insufficient_evidence", corpus_version=retriever.version,
        )
    payload = {"question": question, "conversation": history[-6:],
               "screening_context": context, "evidence": evidence_payload(evidence)}
    # One provider call only. Invalid source IDs/JSON propagate as a genuine
    # unavailable response; they are never rewritten as medical content.
    text = complete(GROUNDING_INSTRUCTION, json.dumps(payload, ensure_ascii=False), DRAFT_JSON_SCHEMA)
    return validate_answer(parse_json(text), evidence, retriever.version)
