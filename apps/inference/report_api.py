"""Dedicated lightweight API for NAYANA screening reports.

This service intentionally has no TensorFlow model, Google GenAI client, or
Supabase credential. It receives result data and an optional user-selected
image attachment only for the lifetime of one PDF response.
"""

from __future__ import annotations

from io import BytesIO
import os
import json
from pathlib import Path
import warnings
from xml.sax.saxutils import escape

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ValidationError
from PIL import Image
from starlette.concurrency import run_in_threadpool


BASE_DIR = Path(__file__).resolve().parent
MAX_PDF_IMAGE_BYTES = 10 * 1024 * 1024
MIN_IMAGE_DIMENSION = 224
MAX_IMAGE_DIMENSION = 4096
MAX_IMAGE_PIXELS = MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION
ALLOWED_IMAGE_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})


class Prediction(BaseModel):
    key: str = Field(pattern=r"^[a-z_]{2,64}$")
    label: str = Field(min_length=1, max_length=120)
    score: float = Field(ge=0, le=1)


class ScreeningResult(BaseModel):
    screening_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,160}$")
    source: str = Field(pattern=r"^(demo|upload)$")
    model_version: str = Field(min_length=1, max_length=160)
    top_prediction: Prediction
    predictions: list[Prediction] = Field(min_length=1, max_length=12)
    disclaimer: str = Field(min_length=1, max_length=1000)


class ExecutiveSummary(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    overview: str = Field(min_length=1, max_length=2400)
    general_information: str = Field(min_length=1, max_length=3200)
    common_factors: str = Field(min_length=1, max_length=3200)
    what_to_notice: str = Field(min_length=1, max_length=3200)
    next_step: str = Field(min_length=1, max_length=2400)
    disclaimer: str = Field(min_length=1, max_length=1600)


app = FastAPI(
    title="NAYANA Report API",
    version="0.1.0",
    description="Layanan ringan pembuatan ringkasan PDF NAYANA.",
)

default_web_origins = (
    "http://localhost:5173,http://localhost:5174,"
    "http://127.0.0.1:5173,http://127.0.0.1:5174,"
    "https://nayana.dielz032.workers.dev"
)
configured_web_origins = os.getenv("NAYANA_WEB_ORIGINS", "")
allowed_origins = list(dict.fromkeys(
    origin.strip()
    for origin in [*default_web_origins.split(","), *configured_web_origins.split(",")]
    if origin.strip()
))
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^https?://(?:localhost|127\.0\.0\.1)(?::(?:5173|5174))?$",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def harden_api_responses(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    if request.method == "POST":
        response.headers["Cache-Control"] = "no-store"
    return response


def decode_pdf_attachment(image_bytes: bytes | None) -> tuple[BytesIO, int, int] | None:
    """Validate a one-request attachment without persisting it."""

    if not image_bytes:
        return None
    if len(image_bytes) > MAX_PDF_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Lampiran foto untuk PDF melebihi batas 10 MB.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(image_bytes)) as image:
                if image.format not in ALLOWED_IMAGE_FORMATS:
                    raise ValueError("Format gambar tidak didukung.")
                if getattr(image, "n_frames", 1) != 1:
                    raise ValueError("Gambar animasi tidak didukung.")
                width, height = image.size
                if width * height > MAX_IMAGE_PIXELS or min(width, height) < MIN_IMAGE_DIMENSION:
                    raise ValueError("Dimensi gambar tidak valid.")
                image.load()
    except (Image.DecompressionBombError, Image.DecompressionBombWarning, OSError, ValueError) as error:
        raise HTTPException(status_code=400, detail="Lampiran foto untuk PDF bukan gambar yang valid.") from error
    return BytesIO(image_bytes), width, height


def build_screening_pdf(
    screening: ScreeningResult,
    summary: ExecutiveSummary | None,
    image_bytes: bytes | None,
    discussion_questions: list[dict[str, str]],
) -> BytesIO:
    """Create a non-diagnostic PDF and, only when requested, an image appendix."""

    from reportlab.lib.colors import HexColor
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import HRFlowable, Image as PdfImage, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

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
    story.extend([
        Spacer(1, 10 * mm),
        Paragraph("RINGKASAN SKRINING AWAL", ParagraphStyle("kicker", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=blue)),
        Spacer(1, 3 * mm),
    ])
    story.append(Paragraph(
        "Pola paling mirip dengan " + escape(screening.top_prediction.label.lower()) + ".",
        ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=25, leading=29, textColor=ink),
    ))
    story.extend([
        Spacer(1, 5 * mm),
        Paragraph(
            "Persentase berikut menunjukkan kemiripan pola dalam kategori model, bukan ukuran keparahan.",
            ParagraphStyle("intro", fontName="Helvetica", fontSize=10, leading=15, textColor=muted),
        ),
        Spacer(1, 8 * mm),
        HRFlowable(width="100%", color=HexColor("#D8D8D3"), thickness=.5),
        Spacer(1, 4 * mm),
    ])
    rows = [[
        Paragraph("Kategori", ParagraphStyle("head", fontName="Helvetica-Bold", fontSize=9, textColor=ink)),
        Paragraph("Kemiripan pola", ParagraphStyle("head2", fontName="Helvetica-Bold", fontSize=9, textColor=ink)),
    ]]
    for prediction in screening.predictions:
        rows.append([escape(prediction.label), f"{round(prediction.score * 100)}%"])
    table = Table(rows, colWidths=[125 * mm, 45 * mm])
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 10),
        ("TEXTCOLOR", (0, 1), (-1, -1), ink),
        ("LINEBELOW", (0, 0), (-1, -1), .5, HexColor("#D8D8D3")),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
    ]))
    story.extend([table, Spacer(1, 10 * mm)])
    if summary:
        body_style = ParagraphStyle("body", fontName="Helvetica", fontSize=10, leading=15, textColor=muted)
        heading_style = ParagraphStyle("section", fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=ink, spaceBefore=7, spaceAfter=3)
        story.append(Paragraph("Ringkasan edukatif", heading_style))
        for label, text in (
            ("Gambaran awal", summary.overview),
            ("Tentang pola ini", summary.general_information),
            ("Faktor umum", summary.common_factors),
            ("Langkah berikutnya", summary.next_step),
        ):
            story.append(Paragraph(label, ParagraphStyle("label-" + label, fontName="Helvetica-Bold", fontSize=9, leading=13, textColor=blue, spaceBefore=5)))
            story.append(Paragraph(escape(text), body_style))
        story.append(Spacer(1, 6 * mm))
        story.append(Paragraph(escape(summary.disclaimer), ParagraphStyle("disclaimer", fontName="Helvetica", fontSize=8.5, leading=12, textColor=muted)))
    if discussion_questions:
        question_label_style = ParagraphStyle("question-label", fontName="Helvetica-Bold", fontSize=8, leading=11, textColor=blue, spaceBefore=7, spaceAfter=2)
        question_style = ParagraphStyle("question", fontName="Helvetica-Bold", fontSize=10, leading=15, textColor=ink, spaceAfter=3)
        purpose_style = ParagraphStyle("question-purpose", fontName="Helvetica", fontSize=8.5, leading=12, textColor=muted, spaceAfter=5)
        discussion_block = [
            Spacer(1, 6 * mm),
            Paragraph("Pertanyaan untuk diskusi dengan Sp.M", heading_style if summary else ParagraphStyle("kit-heading", fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=ink)),
            Paragraph("Pertanyaan ini dipilih pengguna untuk membantu memulai diskusi. Tujuannya menjelaskan informasi apa yang dapat dibantu dokter, bukan sebagai arahan medis.", ParagraphStyle("kit-note", fontName="Helvetica", fontSize=9, leading=13, textColor=muted)),
        ]
        for index, item in enumerate(discussion_questions[:3], start=1):
            discussion_block.extend([
                Paragraph(f"PERTANYAAN {index}", question_label_style),
                Paragraph(escape(item["question"]), question_style),
                Paragraph("<b>Tujuan:</b> " + escape(item["purpose"]), purpose_style),
            ])
        # The short section belongs on one page. Keeping it together avoids a
        # heading or a single question being stranded at the page boundary.
        story.append(KeepTogether(discussion_block))
    attachment = decode_pdf_attachment(image_bytes)
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
                "Foto ini disertakan atas pilihan pengguna sebagai referensi visual. Gunakan file foto terpisah bila detail atau pembesaran diperlukan.",
                ParagraphStyle("attachment-note", fontName="Helvetica", fontSize=9, leading=13, textColor=muted),
            ),
            Spacer(1, 8 * mm),
            PdfImage(image_buffer, width=width * scale, height=height * scale),
        ])
    story.extend([
        Spacer(1, 7 * mm),
        HRFlowable(width="100%", color=HexColor("#D8D8D3"), thickness=.5),
        Spacer(1, 3 * mm),
        Paragraph(
            "NAYANA adalah pendamping edukasi dari foto fundus. Dokumen ini bukan penetapan kondisi medis dan tidak menggantikan pemeriksaan langsung oleh dokter spesialis mata (Sp.M).",
            ParagraphStyle("footer", fontName="Helvetica", fontSize=8, leading=12, textColor=muted),
        ),
    ])
    document.build(story)
    buffer.seek(0)
    return buffer


@app.get("/v1/health")
def health_check():
    return {"status": "ready", "service": "report"}


@app.post("/v1/screenings/report.pdf")
async def create_screening_pdf(
    screening: str = Form(...),
    summary: str | None = Form(default=None),
    discussion_questions: str | None = Form(default=None),
    fundus_image: UploadFile | None = File(default=None),
):
    try:
        parsed_screening = ScreeningResult.model_validate_json(screening)
        parsed_summary = ExecutiveSummary.model_validate_json(summary) if summary and summary != "null" else None
    except ValidationError as error:
        raise HTTPException(status_code=422, detail="Data hasil untuk PDF tidak valid.") from error
    try:
        raw_questions = json.loads(discussion_questions) if discussion_questions else []
        if not isinstance(raw_questions, list) or len(raw_questions) > 3:
            raise ValueError("Pertanyaan tidak valid.")
        parsed_questions = []
        for item in raw_questions:
            # Plain strings remain valid for earlier web clients. Newer clients
            # send the associated purpose so the PDF is useful in consultation.
            if isinstance(item, str):
                question, purpose = item.strip(), "Pertanyaan ini dipilih untuk membantu memulai diskusi dengan dokter spesialis mata."
            elif isinstance(item, dict):
                question = item.get("question", "").strip() if isinstance(item.get("question"), str) else ""
                purpose = item.get("purpose", "").strip() if isinstance(item.get("purpose"), str) else ""
            else:
                raise ValueError("Pertanyaan tidak valid.")
            if not question or len(question) > 500 or not purpose or len(purpose) > 500:
                raise ValueError("Pertanyaan tidak valid.")
            parsed_questions.append({"question": question, "purpose": purpose})
    except (ValueError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=422, detail="Pertanyaan diskusi untuk PDF tidak valid.") from error
    image_bytes = await fundus_image.read() if fundus_image else None
    pdf = await run_in_threadpool(build_screening_pdf, parsed_screening, parsed_summary, image_bytes, parsed_questions)
    filename = "nayana-skrining-" + parsed_screening.screening_id + ".pdf"
    return StreamingResponse(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="' + filename + '"'},
    )
