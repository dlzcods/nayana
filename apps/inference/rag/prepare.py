"""Deterministic extraction and character-first, token-safe chunking."""
from __future__ import annotations

import json
import re

from .common import ARTIFACTS, ATTRIBUTION, MODEL, digest, sources, write_json

CHUNK_CHARS = 1500
OVERLAP_CHARS = 300
MAX_TOKENS = 512
EXCLUDED_HEADINGS = re.compile(
    r"^(research news|what(?:.s| is) the latest research|.* resources$|have a question|"
    r"want more news|nei press office|looking for more sources|related (content|articles)|"
    r"success$|error$|featured resource|healthy aging month|need help finding)", re.I
)


def plain(text: str) -> str:
    text = re.sub(r"!\[[^\]]*\]\([^\n]*?\)", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^\n]*?\)", r"\1", text)
    text = text.replace("This link is external to nei.nih.gov and will open in a new browser window or tab.", "")
    text = re.sub(r"(?m)^\s*-\s*$", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return re.sub(r"[ \t]+", " ", text).strip()


def sections(markdown: str) -> tuple[str, list[dict], str | None]:
    """Drop modules, not medical content. Preserve warnings within each section."""
    title = ""
    heading = "Overview"
    rows: list[dict] = []
    buffer: list[str] = []
    excluded_level: int | None = None
    updated = re.search(r"Last updated:\s*([^\n]+)", markdown, re.I)

    def flush() -> None:
        text = plain("\n".join(buffer))
        if text and not text.startswith("On this page:"):
            rows.append({"heading": heading, "text": text})
        buffer.clear()

    for line in markdown.splitlines():
        if re.search(r'Select "Yes" or "No[.!?]?"|A red asterisk', line, re.I):
            flush()
            break  # Feedback widget follows the article; never part of the corpus.
        match = re.match(r"^(#{1,6})\s+(.+)", line)
        if match:
            level, label = len(match[1]), plain(match[2])
            if level == 1 and not title:
                title = label
                buffer.clear()  # Firecrawl sometimes retains a pre-title site banner.
                continue
            if not title:
                continue
            flush()
            if EXCLUDED_HEADINGS.search(label):
                excluded_level = level
            elif excluded_level is not None and level <= excluded_level:
                excluded_level = None
            if excluded_level is None:
                heading = label
        elif title and excluded_level is None:
            if re.search(r"^(Last updated:|\[?Was this page helpful|\[?Back to top)", line.strip(), re.I):
                continue
            buffer.append(line)
    flush()
    if not title or sum(len(row["text"]) for row in rows) < 250:
        raise ValueError("Article heading/body missing; inspect Firecrawl extraction")
    return title, rows, updated[1].strip() if updated else None


def token_count(tokenizer, text: str) -> int:
    return len(tokenizer.encode(text, add_special_tokens=True, truncation=False))


def split_text(text: str, prefix: str, tokenizer) -> list[tuple[str, int, int]]:
    """Character windows are shortened at sentence boundaries and never truncated.

    Each tuple retains offsets into the cleaned section. Overlap is at most 300
    characters and stays inside the same heading. Every non-space character is covered.
    """
    if token_count(tokenizer, prefix) >= MAX_TOKENS - 32:
        raise ValueError("Heading is too long for the embedding budget")
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + CHUNK_CHARS, len(text))
        while token_count(tokenizer, prefix + text[start:end]) > MAX_TOKENS:
            end = start + max(1, int((end - start) * .9))
            if end <= start + 1:
                raise ValueError("Cannot fit text in embedding token budget")
        if end < len(text):
            boundaries = list(re.finditer(r"(?:[.!?]\s+|\n\n)", text[start:end]))
            if boundaries and boundaries[-1].end() > (end - start) * .5:
                end = start + boundaries[-1].end()
            else:
                space = text.rfind(" ", start, end)
                if space > start:
                    end = space + 1
        piece = text[start:end].strip()
        if piece:
            chunks.append((piece, start, end))
        if end == len(text):
            break
        next_start = max(start + 1, end - OVERLAP_CHARS)
        # Begin overlap at a sentence/newline when available, otherwise a word.
        boundary = re.search(r"[.!?]\s+|\n\n", text[next_start:end])
        if boundary:
            next_start += boundary.end()
        else:
            space = text.find(" ", next_start, end)
            if space >= 0:
                next_start = space + 1
        start = min(next_start, end)
    return chunks


def prepare(tokenizer) -> list[dict]:
    result = []
    report = []
    for source in sources():
        raw = json.loads((ARTIFACTS / "raw" / f"{source['id']}.json").read_text())
        if raw["url"] != source["url"] or digest(raw["markdown"]) != raw["raw_sha256"]:
            raise ValueError("Raw snapshot integrity/allowlist mismatch")
        title, parts, updated = sections(raw["markdown"])
        for part in parts:
            prefix = f"passage: {title} > {part['heading']}\n"
            for text, start, end in split_text(part["text"], prefix, tokenizer):
                embedding_text = prefix + text
                result.append({
                    "id": source["id"] + "-" + digest(part["heading"] + "\n" + text)[:16],
                    "source_id": source["id"], "topic": source["topic"],
                    "url": source["url"], "title": title, "heading": part["heading"],
                    "text": text, "embedding_text": embedding_text,
                    "token_count": token_count(tokenizer, embedding_text),
                    "start": start, "end": end, "source_updated_at": updated,
                    "fetched_at": raw["fetched_at"], "attribution": ATTRIBUTION,
                })
        report.append({"source_id": source["id"], "title": title,
                       "headings": [part["heading"] for part in parts], "updated_at": updated})
    # Exact duplicated chunks do not become independent retrieval evidence.
    result = list({item["id"]: item for item in result}.values())
    write_json(ARTIFACTS / "prepared" / "chunks.json", result)
    write_json(ARTIFACTS / "prepared" / "report.json", {
        "model": MODEL, "articles": report, "chunks": len(result),
        "chunk_chars": CHUNK_CHARS, "overlap_chars": OVERLAP_CHARS,
        "max_tokens": max(item["token_count"] for item in result), "truncated_chunks": 0,
    })
    return result
