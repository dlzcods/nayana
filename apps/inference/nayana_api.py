"""HTTP API for the NAYANA demo screening flow.

This is intentionally separate from ``app.py``.  The existing Gradio interface
remains a research prototype, while this module exposes the narrow API contract
used by the NAYANA web application during stages 0 and 1.

Bundled demo images provide the initial end-to-end screening flow. Personal
uploads currently stop at a consent-gated, metadata-stripping local file check;
they are not yet sent to the disease-classification model or stored.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import re
import time
import uuid
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import Literal

import numpy as np
import tensorflow as tf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, model_validator
from PIL import Image
from starlette.concurrency import run_in_threadpool
from rag.citations import Citation, PROMPT_VERSION


BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "model"
EXAMPLES_DIR = BASE_DIR / "assets" / "examples"
MODEL_VERSION = "eye-disease-classification-savedmodel"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MIN_IMAGE_DIMENSION = 224
MAX_IMAGE_DIMENSION = 4096
DEFAULT_GEMINI_MODEL = "gemma-4-26b-a4b-it"
# Modal permits this endpoint to execute for 300 seconds. Keep the provider
# deadline aligned so an otherwise active generation is not cut off at 120s.
# This is operational configuration, not a secret or Modal environment variable.
RAG_PROVIDER_TIMEOUT_MS = 300_000
MAX_USER_CHAT_CHARS = 900
MAX_ASSISTANT_CHAT_CHARS = 4000
MAX_PDF_IMAGE_BYTES = 10 * 1024 * 1024
MAX_PDF_IMAGE_BASE64_CHARS = 14_000_000
LABELS = (
    ("cataract", "Katarak"),
    ("diabetic_retinopathy", "Retinopati diabetik"),
    ("glaucoma", "Glaukoma"),
    ("normal", "Kategori normal"),
)

DEMO_CASES = (
    {
        "id": "fundus-01",
        "filename": "0_right_h.png",
        "title": "Contoh fundus 01",
        "description": "Pilih untuk melihat alur skrining awal NAYANA.",
    },
    {
        "id": "fundus-02",
        "filename": "03fd50da928d_dr.png",
        "title": "Contoh fundus 02",
        "description": "Pilih untuk melihat alur skrining awal NAYANA.",
    },
    {
        "id": "fundus-03",
        "filename": "108_right_h.png",
        "title": "Contoh fundus 03",
        "description": "Pilih untuk melihat alur skrining awal NAYANA.",
    },
    {
        "id": "fundus-04",
        "filename": "1062_right_c.png",
        "title": "Contoh fundus 04",
        "description": "Pilih untuk melihat alur skrining awal NAYANA.",
    },
    {
        "id": "fundus-05",
        "filename": "1084_right_c.png",
        "title": "Contoh fundus 05",
        "description": "Pilih untuk melihat alur skrining awal NAYANA.",
    },
    {
        "id": "fundus-06",
        "filename": "image_1002_g.jpg",
        "title": "Contoh fundus 06",
        "description": "Pilih untuk melihat alur skrining awal NAYANA.",
    },
)
CASE_BY_ID = {case["id"]: case for case in DEMO_CASES}
logger = logging.getLogger(__name__)


class DemoCase(BaseModel):
    id: str
    title: str
    description: str
    image_url: str


class DemoScreeningRequest(BaseModel):
    case_id: str = Field(description="ID case dari GET /v1/demo-cases")


class Prediction(BaseModel):
    key: str
    label: str
    score: float = Field(ge=0, le=1)


class ScreeningResult(BaseModel):
    screening_id: str
    source: Literal["demo", "upload"]
    case_id: str | None = None
    model_version: str
    top_prediction: Prediction
    predictions: list[Prediction]
    disclaimer: str


class ExecutiveSummary(BaseModel):
    title: str
    overview: str
    general_information: str
    common_factors: str
    what_to_notice: str
    next_step: str
    disclaimer: str


class ExecutiveSummaryRequest(BaseModel):
    screening: ScreeningResult


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_ASSISTANT_CHAT_CHARS)

    @model_validator(mode="after")
    def validate_role_specific_length(self):
        limit = MAX_USER_CHAT_CHARS if self.role == "user" else MAX_ASSISTANT_CHAT_CHARS
        if len(self.content) > limit:
            subject = "Pertanyaan pengguna" if self.role == "user" else "Jawaban asisten"
            raise ValueError(f"{subject} maksimal {limit} karakter.")
        return self


class ScreeningChatRequest(BaseModel):
    screening: ScreeningResult
    summary: ExecutiveSummary | None = None
    messages: list[ChatMessage] = Field(min_length=1, max_length=10)


class ScreeningChatResponse(BaseModel):
    answer: str
    citations: list[Citation] = Field(default_factory=list, max_length=24)
    source_status: Literal["grounded", "insufficient_evidence", "application_context"] | None = None
    corpus_version: str | None = None


class SuggestedQuestion(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9-]{3,64}$")
    question: str = Field(min_length=12, max_length=180)
    # RAG starter chips are navigation prompts. Selecting one always runs the
    # normal grounded chat request rather than displaying a cached answer.
    answer: str | None = Field(default=None, min_length=40, max_length=4000)
    citations: list[Citation] = Field(default_factory=list, max_length=24)
    source_status: Literal["grounded", "insufficient_evidence", "application_context"] | None = None
    corpus_version: str | None = None


class SuggestedQuestionRequest(BaseModel):
    screening: ScreeningResult
    summary: ExecutiveSummary | None = None


class SuggestedQuestionResponse(BaseModel):
    questions: list[SuggestedQuestion] = Field(min_length=6, max_length=6)


class ScreeningPdfRequest(BaseModel):
    screening: ScreeningResult
    summary: ExecutiveSummary | None = None
    fundus_image_base64: str | None = Field(default=None, max_length=MAX_PDF_IMAGE_BASE64_CHARS)


app = FastAPI(
    title="NAYANA Screening API",
    version="0.1.0",
    description="API demo skrining awal NAYANA. Bukan penetapan kondisi medis.",
)

default_web_origins = (
    "http://localhost:5173,http://localhost:5174,"
    "https://nayana.dielz032.workers.dev"
)
allowed_origins = [
    origin.strip()
    for origin in os.getenv("NAYANA_WEB_ORIGINS", default_web_origins).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

def case_image_path(case: dict[str, str]) -> Path:
    path = EXAMPLES_DIR / case["filename"]
    if not path.is_file():
        raise HTTPException(status_code=503, detail="Aset contoh belum tersedia.")
    return path


@lru_cache(maxsize=1)
def load_model():
    if not MODEL_PATH.is_dir():
        raise RuntimeError("Artefak model belum tersedia. Jalankan download-model.sh terlebih dahulu.")
    return tf.saved_model.load(str(MODEL_PATH))


def predict_image(image: Image.Image) -> list[Prediction]:
    resized = image.convert("RGB").resize((224, 224))

    image_array = np.asarray(resized, dtype=np.float32) / 255.0
    image_array = np.expand_dims(image_array, axis=0)
    model = load_model()
    scores = model.signatures["serving_default"](
        tf.convert_to_tensor(image_array, dtype=tf.float32)
    )["output_0"].numpy()[0]

    predictions = [
        Prediction(key=key, label=label, score=float(score))
        for (key, label), score in zip(LABELS, scores, strict=True)
    ]
    return sorted(predictions, key=lambda prediction: prediction.score, reverse=True)


def predict_path(image_path: Path) -> list[Prediction]:
    with Image.open(image_path) as image:
        return predict_image(image)


def predict_bytes(image_bytes: bytes) -> list[Prediction]:
    with Image.open(BytesIO(image_bytes)) as image:
        return predict_image(image)


def normalize_upload(raw_image: bytes) -> bytes:
    """Decode and rewrite an upload without metadata, entirely in memory."""

    if not raw_image:
        raise HTTPException(status_code=400, detail="Pilih satu foto fundus terlebih dahulu.")
    if len(raw_image) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Ukuran foto melebihi batas 10 MB.")

    try:
        with Image.open(BytesIO(raw_image)) as opened_image:
            image = opened_image.convert("RGB")
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=400, detail="File gambar tidak dapat dibaca.") from error

    if min(image.size) < MIN_IMAGE_DIMENSION:
        raise HTTPException(status_code=400, detail="Foto terlalu kecil untuk diperiksa.")

    image.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION))
    output = BytesIO()
    image.save(output, format="JPEG", quality=90, optimize=True)
    return output.getvalue()


SUMMARY_SYSTEM_INSTRUCTION = """
Anda adalah pendamping edukasi kesehatan mata NAYANA untuk masyarakat umum Indonesia.
Tugas Anda adalah menyusun ringkasan edukatif yang jelas, tenang, dan mudah dipahami
dari `screening_context` yang diberikan. Konteks hanya berisi hasil perbandingan pola
dari satu foto fundus. Konteks tidak memuat foto, nama, usia, gejala, riwayat kesehatan,
hasil tekanan mata, maupun hasil pemeriksaan langsung pengguna.

TUJUAN
Bantu pengguna memahami seluruh hasil skrining awal, mengenal pola dengan kemiripan
tertinggi secara umum, memahami faktor yang sering berkaitan, serta mengetahui langkah
berikutnya yang wajar bersama dokter spesialis mata (Sp.M).

ATURAN KESELAMATAN DAN BAHASA
- Ini adalah skrining awal berdasarkan satu foto fundus, bukan penetapan kondisi medis,
  penilaian keparahan, resep, atau pengganti pemeriksaan klinis.
- Jangan memakai kata "diagnosis", "pasti", atau bentuk turunannya pada output.
- Jangan menyatakan pengguna memiliki, tidak memiliki, atau akan mengalami kondisi tertentu.
- Jangan membuat kesimpulan pribadi tentang gejala, usia, gaya hidup, riwayat keluarga,
  penyebab pribadi, prognosis, atau hasil pemeriksaan lain.
- Jangan memberi instruksi pengobatan, dosis, obat, tindakan medis, atau keputusan darurat.
- Gunakan bahasa awam. Bila istilah medis diperlukan, jelaskan artinya secara singkat.
- Gunakan istilah "skrining awal", "indikasi model", "kemiripan pola", dan
  "pola yang paling mirip".
- Keputusan klinis dan pemeriksaan menyeluruh tetap dilakukan oleh dokter spesialis mata (Sp.M).
- Jangan mengubah, membulatkan ulang, menambah, mengurangi, atau menyusun ulang skor,
  label, serta peringkat pada `screening_context`.
- Jangan membuat klaim prevalensi, akurasi, keberhasilan, maupun rujukan ilmiah yang tidak
  tersedia dalam `screening_context`.
- Saat menyebut hal yang mungkin diperhatikan oleh orang awam, nyatakan dengan jelas bahwa
  itu informasi umum, tidak dibaca dari foto pengguna, dan tidak berlaku untuk semua orang.

CARA MEMBACA VARIABEL
- Gunakan `screening_context.categories` untuk membahas seluruh kategori hasil.
- Gunakan `screening_context.focus.top_label` dan
  `screening_context.focus.top_score_percent` hanya sebagai fokus edukasi umum.
- Jangan mengasumsikan nama atau jumlah kategori tertentu. Gunakan hanya kategori yang benar-benar
  tersedia dalam `screening_context.categories`.
- Jika `screening_context.focus.is_reference_normal` bernilai true, jangan memaksakan
  penjelasan penyakit. Jelaskan makna pola yang lebih dekat dengan kategori acuan normal
  dalam perbandingan model, serta batas dari satu foto fundus.
- Jika `screening_context.focus.is_reference_normal` bernilai false, berikan edukasi umum
  mengenai pola dengan kemiripan tertinggi tanpa mengaitkannya secara pribadi kepada pengguna.

FORMAT OUTPUT
Kembalikan SATU objek JSON murni, bukan array dan tanpa markdown.
Jangan gunakan bullet, nomor, emoji, atau teks di luar JSON.

Gunakan field tepat berikut:
title, overview, general_information, common_factors, what_to_notice, next_step, disclaimer.

KETENTUAN SETIAP FIELD
- Semua field harus berbahasa Indonesia dan maksimal tiga kalimat pendek.
- Hindari pengulangan informasi antarfield. Gunakan nada membantu dan tidak mengkhawatirkan
  secara berlebihan.
- title: judul singkat, netral, dan sesuai top_label tanpa menyatakan pengguna memiliki kondisi.
- overview: jelaskan bahwa seluruh kategori dibandingkan, soroti pola tertinggi secara hati-hati,
  dan terangkan bahwa persentase adalah kemiripan pola, bukan ukuran keparahan.
- general_information: bila is_reference_normal false, jelaskan pengertian umum pola pada
  top_label, bagian atau fungsi mata yang umumnya berkaitan, serta mengapa perlu diperhatikan.
  Bila true, jelaskan arti kategori acuan normal dalam perbandingan model.
- common_factors: jelaskan tiga sampai lima faktor umum yang sering berkaitan dengan top_label,
  dipisahkan titik koma. Jangan menyatakan faktor tersebut dimiliki pengguna. Bila normal,
  jelaskan faktor umum yang membuat pemeriksaan mata berkala tetap bermanfaat.
- what_to_notice: jelaskan dua sampai empat hal yang mungkin dapat diperhatikan orang awam bila
  relevan. Bedakan hal sehari-hari dengan hal yang perlu pemeriksaan langsung, dan tegaskan
  bagian ini bukan pembacaan dari foto pengguna.
- next_step: berikan langkah praktis yang tenang, termasuk kapan membawa hasil ini ke Sp.M bila
  ada keluhan penglihatan, perubahan mendadak, nyeri, atau faktor risiko relevan. Jangan memberi
  instruksi pengobatan atau tindakan mandiri.
- disclaimer: satu kalimat bahwa hasil ini skrining awal dari satu foto fundus dan tidak
  menggantikan pemeriksaan langsung oleh dokter spesialis mata (Sp.M).
""".strip()


CHAT_SYSTEM_INSTRUCTION = """
Anda adalah pendamping edukasi NAYANA untuk pertanyaan lanjutan setelah skrining foto fundus.
Jawab dalam Bahasa Indonesia yang hangat, jelas, dan cukup mendalam untuk masyarakat umum.
Gunakan hanya `screening_context`, daftar topik yang sudah dicakup ringkasan, dan pertanyaan pengguna.

PERAN PERCAKAPAN
- Ringkasan awal sudah memberi orientasi umum. Jangan menyalin, merangkum ulang, atau
  memulai kembali isi ringkasan kecuali pengguna secara eksplisit memintanya.
- Jawab inti pertanyaan pengguna secara langsung pada kalimat pertama. Setelah itu,
  kembangkan jawaban dengan informasi umum yang benar-benar menjawab alasan, proses,
  pilihan penanganan tingkat tinggi, faktor yang umumnya memengaruhi, atau hal praktis
  yang relevan dengan jenis pertanyaannya.
- Untuk pertanyaan tentang kemungkinan perbaikan, perkembangan, atau penanganan kondisi,
  jelaskan makna perbaikan secara umum, pendekatan yang lazim dibahas secara klinis tanpa
  memberi resep/pilihan personal, dan hal yang biasanya perlu diperiksa sebelum dokter
  dapat memberi penilaian individual.
- Untuk pertanyaan tentang gejala atau hal yang perlu diperhatikan, jelaskan perbedaan
  antara perubahan sehari-hari yang layak dicatat, informasi yang berguna dibawa saat
  konsultasi, dan tanda yang perlu diprioritaskan.
- Untuk pertanyaan tentang pemeriksaan lanjutan, jelaskan tujuan pemeriksaan dan informasi
  yang dapat diperoleh secara umum, bukan hanya menyarankan pengguna untuk berkonsultasi.
- Untuk pertanyaan tentang persentase atau hasil model, jelaskan arti praktis angka tersebut,
  batasnya, dan bagaimana memakainya sebagai bahan diskusi; jangan hanya mengulang disclaimer.
- Bila pertanyaan terlalu umum, bantu pengguna mempersempitnya dengan satu pertanyaan
  tindak lanjut yang netral. Jangan mengulang definisi, persentase, atau disclaimer yang
  sudah dibahas jika tidak relevan dengan pertanyaan.

URUTAN JAWABAN NORMAL
1. Jawaban langsung yang jelas.
2. Dua sampai tiga penjelasan substantif yang memperdalam jawaban sesuai jenis pertanyaan.
3. Satu langkah praktis atau informasi yang dapat disiapkan untuk diskusi dengan Sp.M.
4. Penutup batas keselamatan yang lengkap dan relevan.

Jangan mengorbankan penjelasan inti demi mengulang batasan. Pada pertanyaan non-darurat,
bagian substantif harus menjadi mayoritas jawaban. Jangan membuka jawaban dengan kalimat
tentang keterbatasan skrining kecuali pengguna menanyakan arti atau keterbatasan hasil.

BATAS KESELAMATAN
- Hasil adalah skrining awal dari satu foto, bukan penetapan kondisi medis atau tingkat keparahan.
- Jangan gunakan kata "diagnosis" atau "pasti".
- Jangan menyatakan pengguna memiliki atau tidak memiliki suatu kondisi.
- Jangan memberi obat, dosis, prosedur, atau menunda bantuan darurat.
- Bila pengguna menyebut kehilangan penglihatan mendadak, nyeri mata hebat, kilatan cahaya baru,
  banyak floaters mendadak, atau cedera mata: sarankan pemeriksaan segera di layanan medis.
- Untuk pertanyaan yang membutuhkan pemeriksaan langsung, jelaskan batasnya dan arahkan ke
  dokter spesialis mata (Sp.M). Jangan mengarang detail dari foto.
- Jangan menyebut proses internal model, chain-of-thought, atau API.

GAYA JAWABAN
- Gunakan tiga sampai lima paragraf pendek yang mudah dipindai. Bila pengguna meminta daftar,
  gunakan maksimal enam poin singkat dengan penjelasan yang tetap substantif.
- Pertahankan disclaimer/batas keselamatan lengkap sebagai paragraf penutup yang terpisah;
  jangan menyisipkannya berulang kali di setiap paragraf inti.
- Sebutkan persentase hanya bila membantu dan pertahankan nilainya persis seperti konteks.
- Bedakan edukasi umum dengan apa yang dapat dipastikan dari foto. Nada tenang, tanpa menghakimi.
""".strip()


SUGGESTED_QUESTIONS_SYSTEM_INSTRUCTION = """
Anda menyusun paket pemantik percakapan NAYANA setelah skrining foto fundus untuk masyarakat umum Indonesia.
Konteks hanya berisi kemiripan pola dari satu foto, bukan gejala, riwayat kesehatan, maupun pemeriksaan langsung.

TUJUAN
Berikan ENAM pertanyaan lanjutan yang berbeda beserta jawaban edukatif singkat yang dapat langsung dibuka pengguna.
Paket ini harus memperdalam diskusi, bukan mengulang executive summary atau sekadar menjelaskan arti persentase.

CAKUP ENAM SUDUT BERBEDA, masing-masing tepat satu:
1. perubahan penglihatan atau hal sehari-hari yang layak dicatat;
2. faktor umum atau riwayat yang relevan untuk dibicarakan dengan Sp.M;
3. pemeriksaan lanjutan yang secara umum dapat membantu memperjelas pola;
4. kapan mengatur konsultasi rutin;
5. tanda perubahan yang perlu mendorong pemeriksaan lebih cepat;
6. cara menyiapkan pertanyaan atau informasi untuk konsultasi.

ATURAN KESELAMATAN
- Gunakan "skrining awal", "kemiripan pola", dan "indikasi model".
- Jangan gunakan kata "diagnosis" atau "pasti".
- Jangan menyatakan pengguna memiliki atau tidak memiliki kondisi, memberi obat/tindakan, atau mengarang temuan dari foto.
- Bila membahas tanda yang mendadak atau berat, sarankan pemeriksaan segera secara tenang.
- Jangan mengulang overview atau definisi umum dari executive summary.
- Setiap jawaban maksimal dua paragraf pendek, total maksimal 130 kata, dan harus dapat berdiri sendiri.

FORMAT
Kembalikan satu objek JSON murni: {"questions":[...]}. Tepat enam item.
Setiap item wajib memiliki `id` berupa slug unik huruf kecil dan strip, `question`, dan `answer`.
""".strip()

SUGGESTION_CACHE_TTL_SECONDS = 60 * 60
SUGGESTION_CACHE_MAX_ITEMS = 48
_suggestion_cache: dict[str, tuple[float, SuggestedQuestionResponse]] = {}


def rag_enabled() -> bool:
    return bool(os.getenv("NAYANA_RAG_VERSION", "").strip())


def rag_completion(instruction: str, payload: str, response_schema: dict | None = None) -> str:
    from rag.stream import ProviderStreamIncomplete, collect_json_stream
    from google import genai
    from google.genai import types
    from rag.citations import as_genai_schema
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Percakapan hasil belum diaktifkan.")
    client = genai.Client(api_key=key)
    model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
    started_at = time.monotonic()
    try:
        response_stream = client.models.generate_content_stream(
            model=model,
            contents=payload,
            config=types.GenerateContentConfig(
                thinking_config=types.ThinkingConfig(thinking_level="HIGH"),
                http_options=types.HttpOptions(timeout=RAG_PROVIDER_TIMEOUT_MS),
                max_output_tokens=4096,
                response_mime_type="application/json",
                response_schema=as_genai_schema(response_schema, types) if response_schema is not None else None,
                system_instruction=instruction,
            ),
        )
        # Structured-output streams are valid partial JSON strings. Join every
        # non-thought chunk before the server parser sees it; never parse an
        # arbitrary mid-stream fragment as a complete response.
        response_text = collect_json_stream(response_stream)
        logger.info(
            "NEI provider completed model=%s elapsed_seconds=%.2f response_characters=%d",
            model, time.monotonic() - started_at, len(response_text),
        )
        return response_text
    except ProviderStreamIncomplete as error:
        logger.warning(
            "NEI provider stopped early model=%s elapsed_seconds=%.2f finish_reason=%s response_characters=%d",
            model, time.monotonic() - started_at, error.reason, error.response_characters,
        )
        raise
    except Exception as error:
        logger.warning(
            "NEI provider request failed model=%s elapsed_seconds=%.2f error_type=%s",
            model, time.monotonic() - started_at, type(error).__name__,
        )
        raise
    finally:
        client.close()


def response_text_without_thoughts(response: object) -> str:
    """Return only non-thought text even if a model ignores include_thoughts."""

    candidates = getattr(response, "candidates", None) or []
    text_parts: list[str] = []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", None) or []:
            if not getattr(part, "thought", False) and getattr(part, "text", None):
                text_parts.append(part.text)
    return "".join(text_parts).strip() or str(getattr(response, "text", "")).strip()


def parse_executive_summary(response_text: str) -> ExecutiveSummary:
    """Accept the one-object contract and a one-item array returned by some models.

    The prompt requests a JSON object. Gemma can nevertheless wrap that object in
    a one-item list. Normalising that harmless transport variation here keeps the
    public API contract stable while rejecting ambiguous multi-item responses.
    """

    parsed = json.loads(response_text)
    if isinstance(parsed, list):
        if len(parsed) != 1 or not isinstance(parsed[0], dict):
            raise ValueError("Ringkasan model harus berisi tepat satu objek JSON.")
        parsed = parsed[0]
    summary = ExecutiveSummary.model_validate(parsed)
    return ExecutiveSummary.model_validate({
        field: normalize_public_language(value)
        for field, value in summary.model_dump().items()
    })


def normalize_public_language(text: str) -> str:
    """Replace a few common safety-language slips without dropping a useful answer.

    Gemma occasionally writes phrases such as ``bukan diagnosis`` despite the
    system instruction. Those phrases are medically cautious, but the public
    NAYANA vocabulary intentionally uses ``penetapan kondisi medis`` instead.
    Normalising only these known forms keeps that copy rule while avoiding a
    false 503 after an otherwise safe response.
    """

    normalized = re.sub(
        r"\b(?:bukan|bukanlah)\s+(?:sebuah\s+)?diagnosis\b",
        "bukan penetapan kondisi medis",
        text,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(r"\b(?:mendiagnosis|didiagnosis|diagnosis)\b", "menetapkan kondisi medis", normalized, flags=re.IGNORECASE)
    normalized = re.sub(
        r"\b(?:tidak\s+(?:bisa|dapat)|belum)\s+dipastikan\b",
        "tidak dapat dinilai hanya dari satu foto",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(r"\bpasti\b", "secara meyakinkan", normalized, flags=re.IGNORECASE)
    return normalized


def build_summary_context(screening: ScreeningResult) -> dict[str, object]:
    """Create an explicit, model-agnostic context without sending the image itself."""

    categories = [
        {
            "rank": rank,
            "label": prediction.label,
            "score_percent": round(prediction.score * 100),
        }
        for rank, prediction in enumerate(screening.predictions, start=1)
    ]
    top_prediction = screening.top_prediction
    return {
        "screening_context": {
            "screening_id": screening.screening_id,
            "model_version": screening.model_version,
            "result_basis": (
                "Skor menunjukkan kemiripan pola dari satu foto fundus, "
                "bukan tingkat keparahan."
            ),
            "categories": categories,
            "focus": {
                "top_label": top_prediction.label,
                "top_score_percent": round(top_prediction.score * 100),
                "is_reference_normal": top_prediction.key == "normal",
            },
        }
    }


def generate_executive_summary(screening: ScreeningResult) -> ExecutiveSummary:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Ringkasan otomatis belum diaktifkan.")

    from google import genai
    from google.genai import types

    model_name = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
    prompt = build_summary_context(screening)

    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=model_name,
            contents=json.dumps(prompt, ensure_ascii=False),
            config=types.GenerateContentConfig(
                temperature=0.3,
                response_mime_type="application/json",
                thinking_config=types.ThinkingConfig(
                    thinking_level="HIGH",
                    include_thoughts=False,
                ),
                system_instruction=SUMMARY_SYSTEM_INSTRUCTION,
            ),
        )
        return parse_executive_summary(response_text_without_thoughts(response))
    except HTTPException:
        raise
    except Exception as error:
        logger.exception(
            "Executive summary generation failed (model=%s, error_type=%s)",
            model_name,
            type(error).__name__,
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "Ringkasan otomatis belum dapat dibuat. Hasil skrining tetap dapat dibaca. "
                f"Kode pemeriksaan: {type(error).__name__}."
            ),
        ) from error


def suggestion_cache_key(screening: ScreeningResult) -> str:
    """Cache only the model-result context, never a photo, user id, or free-text chat."""

    return json.dumps(
        {
            "version": PROMPT_VERSION if rag_enabled() else "suggestions-v1",
            "corpus_version": os.getenv("NAYANA_RAG_VERSION", ""),
            "llm": os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL),
            "model_version": screening.model_version,
            "top": screening.top_prediction.key,
            "scores": [(item.key, round(item.score, 3)) for item in screening.predictions],
        },
        sort_keys=True,
        separators=(",", ":"),
    )


def parse_suggested_questions(response_text: str) -> SuggestedQuestionResponse:
    parsed = json.loads(response_text)
    if isinstance(parsed, list):
        if len(parsed) != 1 or not isinstance(parsed[0], dict):
            raise ValueError("Paket pertanyaan model harus berisi tepat satu objek JSON.")
        parsed = parsed[0]
    response = SuggestedQuestionResponse.model_validate(parsed)
    seen_ids: set[str] = set()
    seen_questions: set[str] = set()
    clean_questions: list[SuggestedQuestion] = []
    for item in response.questions:
        normalized_question = normalize_public_language(item.question).strip()
        normalized_answer = normalize_public_language(item.answer).strip() if item.answer else None
        question_key = normalized_question.casefold()
        if item.id in seen_ids or question_key in seen_questions:
            raise ValueError("Pertanyaan pemantik perlu unik.")
        seen_ids.add(item.id)
        seen_questions.add(question_key)
        clean_questions.append(SuggestedQuestion(id=item.id, question=normalized_question, answer=normalized_answer))
    return SuggestedQuestionResponse(questions=clean_questions)


def generate_suggested_questions(payload: SuggestedQuestionRequest) -> SuggestedQuestionResponse:
    if rag_enabled():
        from rag.service import starter_questions
        return SuggestedQuestionResponse(questions=starter_questions(payload.screening.top_prediction.key))
    key = suggestion_cache_key(payload.screening)
    now = time.monotonic()
    cached = _suggestion_cache.get(key)
    if cached and now - cached[0] < SUGGESTION_CACHE_TTL_SECONDS:
        return cached[1]

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Pertanyaan lanjutan belum diaktifkan.")

    from google import genai
    from google.genai import types

    model_name = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
    prompt = {
        **build_summary_context(payload.screening),
        "already_covered": [
            "orientasi seluruh kategori dan makna kemiripan pola",
            "edukasi umum pola tertinggi",
            "faktor umum, hal yang dapat diperhatikan, dan langkah berikutnya",
        ],
    }
    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=model_name,
            contents=json.dumps(prompt, ensure_ascii=False),
            config=types.GenerateContentConfig(
                temperature=0.45,
                response_mime_type="application/json",
                thinking_config=types.ThinkingConfig(thinking_level="HIGH", include_thoughts=False),
                system_instruction=SUGGESTED_QUESTIONS_SYSTEM_INSTRUCTION,
            ),
        )
        result = parse_suggested_questions(response_text_without_thoughts(response))
        if len(_suggestion_cache) >= SUGGESTION_CACHE_MAX_ITEMS:
            oldest_key = min(_suggestion_cache, key=lambda item: _suggestion_cache[item][0])
            _suggestion_cache.pop(oldest_key, None)
        _suggestion_cache[key] = (now, result)
        return result
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Suggested question generation failed (model=%s, error_type=%s)", model_name, type(error).__name__)
        raise HTTPException(status_code=503, detail="Pertanyaan lanjutan belum dapat disiapkan. Anda tetap dapat menulis pertanyaan sendiri.") from error


def generate_screening_chat(payload: ScreeningChatRequest) -> ScreeningChatResponse:
    if payload.messages[-1].role != "user":
        raise HTTPException(status_code=422, detail="Pesan terakhir perlu berupa pertanyaan pengguna.")
    if rag_enabled():
        from rag.service import answer_question
        try:
            result = answer_question(payload.messages[-1].content,
                                     [row.model_dump() for row in payload.messages[:-1]],
                                     payload.screening.top_prediction.key,
                                     build_summary_context(payload.screening), rag_completion)
            # Do not rewrite text after source attribution; it could change the claim.
            return ScreeningChatResponse(**result.model_dump())
        except Exception as error:
            # Keep the public response deliberately non-sensitive, but retain the
            # complete traceback in Modal logs.  Previously this logged only the
            # class name, which made an upstream timeout, malformed model JSON,
            # and a retrieval failure indistinguishable during incident review.
            logger.exception("NEI chat unavailable (error_type=%s)", type(error).__name__)
            raise HTTPException(status_code=503, detail="Jawaban bersumber belum dapat disiapkan. Silakan coba lagi; pertanyaan Anda tidak perlu dihapus.") from None
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Percakapan hasil belum diaktifkan.")

    from google import genai
    from google.genai import types

    model_name = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
    context = build_summary_context(payload.screening)
    request_payload = {
        **context,
        "summary_coverage": [
            "orientasi seluruh kategori dan arti kemiripan pola",
            "edukasi umum pola tertinggi",
            "faktor umum, hal yang dapat diperhatikan, dan langkah berikutnya",
        ] if payload.summary else [],
        "conversation": [message.model_dump() for message in payload.messages],
    }

    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=model_name,
            contents=json.dumps(request_payload, ensure_ascii=False),
            config=types.GenerateContentConfig(
                temperature=0.35,
                thinking_config=types.ThinkingConfig(thinking_level="HIGH", include_thoughts=False),
                system_instruction=CHAT_SYSTEM_INSTRUCTION,
            ),
        )
        answer = response_text_without_thoughts(response).strip()
        if not answer:
            raise ValueError("Jawaban kosong dari model.")
        return ScreeningChatResponse(answer=normalize_public_language(answer))
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Screening chat failed (model=%s, error_type=%s)", model_name, type(error).__name__)
        raise HTTPException(status_code=503, detail="Jawaban belum dapat dibuat. Silakan coba lagi.") from error


def decode_pdf_attachment(image_base64: str | None) -> tuple[BytesIO, int, int] | None:
    """Validate an optional user-selected PDF attachment without persisting it."""

    if not image_base64:
        return None
    try:
        image_bytes = base64.b64decode(image_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=400, detail="Lampiran foto untuk PDF tidak dapat dibaca.") from error
    if not image_bytes or len(image_bytes) > MAX_PDF_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Lampiran foto untuk PDF melebihi batas 10 MB.")
    try:
        image_buffer = BytesIO(image_bytes)
        with Image.open(image_buffer) as image:
            image.load()
            width, height = image.size
            if min(width, height) < MIN_IMAGE_DIMENSION:
                raise ValueError("Foto terlalu kecil.")
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=400, detail="Lampiran foto untuk PDF bukan gambar yang valid.") from error
    image_buffer.seek(0)
    return image_buffer, width, height


def build_screening_pdf(payload: ScreeningPdfRequest) -> BytesIO:
    """Create an editorial, non-diagnostic PDF report with only supplied result data."""

    from reportlab.lib.colors import HexColor
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import HRFlowable, Image as PdfImage, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title="Ringkasan skrining awal NAYANA",
    )
    styles = getSampleStyleSheet()
    ink = HexColor("#24252B")
    blue = HexColor("#3F5FC7")
    muted = HexColor("#5F6066")
    story = []
    logo_path = BASE_DIR / "assets" / "nayana-logo.png"
    if logo_path.is_file():
        story.append(PdfImage(str(logo_path), width=42 * mm, height=14 * mm, kind="proportional"))
    else:
        story.append(Paragraph("NAYANA", ParagraphStyle("brand", fontName="Helvetica-Bold", fontSize=22, textColor=ink)))
    story.extend([Spacer(1, 10 * mm), Paragraph("RINGKASAN SKRINING AWAL", ParagraphStyle("kicker", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=blue)), Spacer(1, 3 * mm)])
    story.append(Paragraph(
        f"Pola paling mirip dengan {payload.screening.top_prediction.label.lower()}.",
        ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=25, leading=29, textColor=ink),
    ))
    story.extend([Spacer(1, 5 * mm), Paragraph(
        "Persentase berikut menunjukkan kemiripan pola dalam kategori model, bukan ukuran keparahan.",
        ParagraphStyle("intro", fontName="Helvetica", fontSize=10, leading=15, textColor=muted),
    ), Spacer(1, 8 * mm), HRFlowable(width="100%", color=HexColor("#D8D8D3"), thickness=.5), Spacer(1, 4 * mm)])
    rows = [[Paragraph("Kategori", ParagraphStyle("head", fontName="Helvetica-Bold", fontSize=9, textColor=ink)), Paragraph("Kemiripan pola", ParagraphStyle("head2", fontName="Helvetica-Bold", fontSize=9, textColor=ink))]]
    for prediction in payload.screening.predictions:
        rows.append([prediction.label, f"{round(prediction.score * 100)}%"])
    table = Table(rows, colWidths=[125 * mm, 45 * mm])
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"), ("FONTSIZE", (0, 1), (-1, -1), 10),
        ("TEXTCOLOR", (0, 1), (-1, -1), ink), ("LINEBELOW", (0, 0), (-1, -1), .5, HexColor("#D8D8D3")),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
    ]))
    story.extend([table, Spacer(1, 10 * mm)])
    if payload.summary:
        body_style = ParagraphStyle("body", fontName="Helvetica", fontSize=10, leading=15, textColor=muted)
        heading_style = ParagraphStyle("section", fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=ink, spaceBefore=7, spaceAfter=3)
        story.append(Paragraph("Ringkasan edukatif", heading_style))
        for label, text in (("Gambaran awal", payload.summary.overview), ("Tentang pola ini", payload.summary.general_information), ("Faktor umum", payload.summary.common_factors), ("Langkah berikutnya", payload.summary.next_step)):
            story.append(Paragraph(label, ParagraphStyle("label-" + label, fontName="Helvetica-Bold", fontSize=9, leading=13, textColor=blue, spaceBefore=5)))
            story.append(Paragraph(text, body_style))
        story.append(Spacer(1, 6 * mm))
        story.append(Paragraph(payload.summary.disclaimer, ParagraphStyle("disclaimer", fontName="Helvetica", fontSize=8.5, leading=12, textColor=muted)))
    attachment = decode_pdf_attachment(payload.fundus_image_base64)
    if attachment:
        image_buffer, width, height = attachment
        max_width = 170 * mm
        max_height = 220 * mm
        scale = min(max_width / width, max_height / height)
        story.extend([
            PageBreak(),
            Paragraph("Lampiran foto fundus", ParagraphStyle("attachment-title", fontName="Helvetica-Bold", fontSize=17, leading=22, textColor=ink)),
            Spacer(1, 3 * mm),
            Paragraph(
                "Foto ini disertakan atas pilihan pengguna sebagai referensi visual. "
                "Gunakan file foto terpisah bila detail atau pembesaran diperlukan.",
                ParagraphStyle("attachment-note", fontName="Helvetica", fontSize=9, leading=13, textColor=muted),
            ),
            Spacer(1, 8 * mm),
            PdfImage(image_buffer, width=width * scale, height=height * scale),
        ])
    story.extend([Spacer(1, 7 * mm), HRFlowable(width="100%", color=HexColor("#D8D8D3"), thickness=.5), Spacer(1, 3 * mm), Paragraph(
        "NAYANA adalah pendamping edukasi dari foto fundus. Dokumen ini bukan penetapan kondisi medis dan tidak menggantikan pemeriksaan langsung oleh dokter spesialis mata (Sp.M).",
        ParagraphStyle("footer", fontName="Helvetica", fontSize=8, leading=12, textColor=muted),
    )])
    document.build(story)
    buffer.seek(0)
    return buffer


def build_demo_result(case_id: str, screening_id: str) -> ScreeningResult:
    """Build a stateless demo result that works across Modal containers.

    A Modal web request may land on a different container from the preceding
    request. Therefore phase-1 cannot rely on a process-local dictionary for
    result retrieval. The route ID carries only a demo case identifier and a
    random suffix; predictions are regenerated from the bundled demo image when
    a result is reopened. User uploads and persistent history remain later
    Supabase-stage concerns.
    """

    case = CASE_BY_ID.get(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Contoh fundus tidak ditemukan.")

    try:
        predictions = predict_path(case_image_path(case))
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    return ScreeningResult(
        screening_id=screening_id,
        source="demo",
        case_id=case_id,
        model_version=MODEL_VERSION,
        top_prediction=predictions[0],
        predictions=predictions,
        disclaimer=(
            "Hasil ini menggambarkan kemiripan pola pada foto fundus, bukan tingkat "
            "keparahan dan bukan penetapan kondisi medis. Konsultasikan dengan dokter spesialis mata (Sp.M)."
        ),
    )


@app.get("/v1/health")
def health_check():
    rag_version = os.getenv("NAYANA_RAG_VERSION", "").strip()
    return {
        "status": "ready" if MODEL_PATH.is_dir() else "needs_model",
        "model_version": MODEL_VERSION,
        "demo_case_count": len(DEMO_CASES),
        "executive_summary": {
            "configured": bool(os.getenv("GEMINI_API_KEY")),
            "model": os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL),
        },
        "rag": {
            "configured": rag_enabled(),
            "version": rag_version or None,
            "sources": 5 if rag_enabled() else 0,
            "citation_mode": "paragraph",
            "ready": bool(rag_version),
        },
    }


@app.get("/v1/demo-cases", response_model=list[DemoCase])
def list_demo_cases():
    return [
        DemoCase(
            id=case["id"],
            title=case["title"],
            description=case["description"],
            image_url=f"/v1/demo-cases/{case['id']}/image",
        )
        for case in DEMO_CASES
    ]


@app.get("/v1/demo-cases/{case_id}/image")
def get_demo_case_image(case_id: str):
    case = CASE_BY_ID.get(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Contoh fundus tidak ditemukan.")
    return FileResponse(case_image_path(case))


@app.post("/v1/screenings/upload", response_model=ScreeningResult)
async def screen_uploaded_fundus(
    image: UploadFile = File(...),
    age_confirmed: bool = Form(...),
    processing_consent: bool = Form(...),
):
    """Run the SavedModel on a normalized upload without retaining the image."""

    if not age_confirmed:
        raise HTTPException(status_code=400, detail="Fitur ini hanya tersedia untuk pengguna berusia 18 tahun ke atas.")
    if not processing_consent:
        raise HTTPException(status_code=400, detail="Persetujuan pemrosesan foto diperlukan untuk melanjutkan.")
    if image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=400, detail="Gunakan file JPG, PNG, atau WEBP.")

    raw_image = await image.read()
    normalized_image = await run_in_threadpool(normalize_upload, raw_image)

    try:
        predictions = await run_in_threadpool(predict_bytes, normalized_image)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    return ScreeningResult(
        screening_id=f"upload_{uuid.uuid4().hex}",
        source="upload",
        model_version=MODEL_VERSION,
        top_prediction=predictions[0],
        predictions=predictions,
        disclaimer=(
            "Hasil ini menggambarkan kemiripan pola pada foto fundus, bukan tingkat "
            "keparahan dan bukan penetapan kondisi medis. Konsultasikan dengan dokter spesialis mata (Sp.M)."
        ),
    )


@app.post("/v1/screenings/demo", response_model=ScreeningResult)
def screen_demo_case(payload: DemoScreeningRequest):
    screening_id = f"demo_{payload.case_id}_{uuid.uuid4().hex}"
    return build_demo_result(payload.case_id, screening_id)


@app.post("/v1/screenings/executive-summary", response_model=ExecutiveSummary)
async def create_executive_summary(payload: ExecutiveSummaryRequest):
    """Create patient education from scores only, never from the fundus image."""

    return await run_in_threadpool(generate_executive_summary, payload.screening)


@app.post("/v1/screenings/suggested-questions", response_model=SuggestedQuestionResponse)
async def create_suggested_questions(payload: SuggestedQuestionRequest):
    """Warm a result-only starter pack; it never receives an image or user identity."""

    return await run_in_threadpool(generate_suggested_questions, payload)


@app.post("/v1/screenings/chat", response_model=ScreeningChatResponse)
async def create_screening_chat(payload: ScreeningChatRequest):
    return await run_in_threadpool(generate_screening_chat, payload)


@app.post("/v1/screenings/report.pdf")
async def create_screening_pdf(payload: ScreeningPdfRequest):
    pdf = await run_in_threadpool(build_screening_pdf, payload)
    filename = f"nayana-skrining-{payload.screening.screening_id}.pdf"
    return StreamingResponse(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/v1/screenings/{screening_id}", response_model=ScreeningResult)
def get_demo_screening(screening_id: str):
    prefix = "demo_"
    if not screening_id.startswith(prefix) or "_" not in screening_id[len(prefix) :]:
        raise HTTPException(
            status_code=404,
            detail="Hasil demo sudah tidak tersedia. Jalankan contoh fundus kembali.",
        )

    case_id, _random_suffix = screening_id[len(prefix) :].rsplit("_", 1)
    return build_demo_result(case_id, screening_id)
