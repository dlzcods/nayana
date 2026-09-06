import json
from pathlib import Path
from unittest.mock import patch

import pytest

from rag.common import sources
from rag.prepare import sections, split_text, token_count
from rag.citations import validate_answer, parse_json
from rag.retrieve import contextual_query
from rag.service import load_cached_suggestions, persist_suggestions, suggestion_pack


class Tokenizer:
    def encode(self, text, **kwargs):
        # Deliberately harsh tokenizer to exercise forced re-splitting.
        return list(text) + [0, 0]


def evidence():
    return [{"id":"chunk1", "title":"Cataracts", "heading":"Causes", "text":"Original NEI text.",
             "url": sources()[2]["url"], "corpus_version":"nei-test", "fetched_at":"2026-09-06"}]


def draft(ids=None):
    return {"status":"grounded", "blocks":[{"text":"Penjelasan edukatif.", "kind":"evidence", "source_ids":ids if ids is not None else ["chunk1"]}]}


def test_allowlist_exactly_five():
    assert len(sources()) == 5
    assert len({row["url"] for row in sources()}) == 5
    assert all("research-and-training" not in row["url"] for row in sources())


def test_modules_excluded_but_warnings_preserved():
    text = "Site banner\n# Cataracts\n## Symptoms\n" + "Blurry vision. Other conditions may cause similar symptoms. " * 10
    text += "\n## Research News\nMouse experiment\n### New drug\nExperimental\n## Have a Question?\nContact us"
    title, rows, _ = sections(text)
    assert title == "Cataracts"
    assert len(rows) == 1
    assert "Other conditions" in rows[0]["text"]
    assert "experiment" not in str(rows)


def test_feedback_form_and_what_is_latest_research_are_excluded():
    text = "# Keep Your Eyes Healthy\n## Protect your eyes\n" + ("Useful guidance that must remain in the article. " * 8)
    text += '\nWas this page helpful?\nSelect "Yes" or "No." Add comments.\nPrivate form text'
    title, rows, _ = sections(text)
    assert title == "Keep Your Eyes Healthy"
    assert "Useful guidance" in rows[0]["text"]
    assert "Select" not in str(rows) and "Private form" not in str(rows)

    research = "# Cataracts\n## Symptoms\n" + ("Useful symptom guidance. " * 12)
    research += "\n## What is the latest research on cataracts?\nExperimental."
    _, rows, _ = sections(research)
    assert "Experimental" not in str(rows)


def test_chunks_cover_input_without_silent_truncation():
    text = "Sentence with a warning. " * 200
    tokenizer = Tokenizer()
    chunks = split_text(text, "passage: Test > Warning\n", tokenizer)
    covered = set()
    for piece, start, end in chunks:
        covered.update(range(start, end))
        assert token_count(tokenizer, "passage: Test > Warning\n" + piece) <= 512
        assert end - start <= 1500
    assert all(index in covered for index, char in enumerate(text) if not char.isspace())
    assert len(chunks) > 1


def test_same_source_number_reused_and_excerpt_server_owned():
    value = draft()
    value["blocks"] *= 2
    response = validate_answer(value, evidence(), "nei-test")
    assert len(response.citations) == 1
    assert response.answer.count("[1]") == 2
    assert response.citations[0].excerpt == "Original NEI text."


@pytest.mark.parametrize("value", [draft([]), draft(["fabricated"]),
    {"status":"grounded", "blocks":[{"text":"See https://fake.test", "kind":"evidence", "source_ids":["chunk1"]}]},
    {"status":"grounded", "blocks":[{"text":"Source [9]", "kind":"evidence", "source_ids":["chunk1"]}]}])
def test_invalid_citations_rejected(value):
    with pytest.raises(ValueError):
        validate_answer(value, evidence(), "nei-test")


def test_wrong_version_rejected():
    with pytest.raises(ValueError):
        validate_answer(draft(), evidence(), "nei-other")


def test_insufficient_does_not_invent_sources():
    response = validate_answer({"status":"insufficient_evidence", "blocks":[]}, evidence(), "nei-test")
    assert response.citations == []
    assert response.source_status == "insufficient_evidence"


def test_singleton_json_and_fences():
    assert parse_json('```json\n[{"status":"grounded"}]\n```') == {"status":"grounded"}


def test_followup_uses_latest_explicit_topic_not_prediction():
    query = contextual_query("Penyebabnya?", [{"role":"user", "content":"Apa itu glaukoma?"}], "cataract")
    assert "glaucoma" in query and "cataracts" not in query


def test_followup_expands_examination_intent():
    query = contextual_query("Terus diperiksanya seperti apa?", [{"role":"user", "content":"Retinopati diabetik"}], "cataract")
    assert "diabetic retinopathy" in query and "dilated eye exam" in query


def test_general_question_not_forced_to_prediction():
    query = contextual_query("Cara menjaga mata sehat?", [], "cataract")
    assert "healthy vision" in query and "cataracts" not in query


def test_missing_article_fails_closed(tmp_path):
    from rag.prepare import prepare
    with patch("rag.prepare.ARTIFACTS", tmp_path), pytest.raises(FileNotFoundError):
        prepare(Tokenizer())


def test_suggestion_pack_accepts_strict_direct_array():
    row = {**evidence()[0], "source_id":"cataracts", "topic":"cataract", "score":.9,
           "start":0, "end":10, "embedding_text":"passage", "token_count":5}
    class FakeRetriever:
        version = "nei-test"
        def search(self, _query): return [row]
    payload = [{"id":f"question-{index}", "question":f"Apa penjelasan lanjutan nomor {index}?",
                "response":draft()} for index in range(6)]
    with patch("rag.service.get_retriever", return_value=FakeRetriever()):
        result = suggestion_pack("cataract", {}, lambda _instruction, _payload: json.dumps(payload))
    assert len(result) == 6
    assert all(item["citations"][0]["url"] == sources()[2]["url"] for item in result)


def test_persisted_suggestions_verify_checksum_and_chunk_provenance(tmp_path):
    row = {**evidence()[0], "source_id":"cataracts", "topic":"cataract", "score":.9,
           "start":0, "end":10, "embedding_text":"passage", "token_count":5}
    class FakeRetriever:
        version = "nei-test"
        chunks = [row]
        def search(self, _query): return [row]
    payload = [{"id":f"question-{index}", "question":f"Apa penjelasan lanjutan nomor {index}?",
                "response":draft()} for index in range(6)]
    with patch("rag.service.get_retriever", return_value=FakeRetriever()):
        generated = suggestion_pack("cataract", {}, lambda _instruction, _payload: json.dumps(payload))
    with patch("rag.service.ARTIFACTS", tmp_path):
        persist_suggestions("cataract", generated, FakeRetriever())
        assert load_cached_suggestions("cataract", FakeRetriever()) == generated
        checksum = tmp_path / "versions/nei-test/suggestions/cataract.sha256.json"
        checksum.write_text('{"sha256":"wrong"}')
        with pytest.raises(ValueError, match="integrity"):
            load_cached_suggestions("cataract", FakeRetriever())
