import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from rag.citations import DRAFT_JSON_SCHEMA, as_genai_schema, evidence_payload, parse_json, validate_answer
from rag.common import sources
from rag.retrieve import contextual_query
from rag.service import answer_question, starter_questions


def row():
    return {
        "id": "cataracts-overview", "source_id": "cataracts", "title": "Cataracts",
        "heading": "What are cataracts?", "text": "A cataract is a cloudy area in the lens of your eye.",
        "url": sources()[2]["url"], "corpus_version": "nei-test", "fetched_at": "2026-09-08",
    }


def draft(text="Katarak adalah area keruh pada lensa mata."):
    return {"status": "grounded", "blocks": [{
        "text": text, "kind": "evidence", "source_ids": ["cataracts-overview"],
    }]}


def test_allowlist_exactly_five():
    assert len(sources()) == 5
    assert len({item["url"] for item in sources()}) == 5


def test_legacy_paragraph_citation_is_server_owned():
    response = validate_answer(draft(), [row()], "nei-test")
    assert response.answer.endswith("[1]")
    assert response.citations[0].title == "Cataracts"


def test_bracketed_internal_source_id_is_removed_before_rendering():
    response = validate_answer(draft("Katarak adalah area keruh. [cataracts-overview]"), [row()], "nei-test")
    assert "cataracts-overview" not in response.answer
    assert response.answer.endswith("[1]")


def test_unbracketed_internal_source_id_is_rejected():
    with pytest.raises(ValueError, match="evidence ID"):
        validate_answer(draft("Katarak cataracts-overview adalah area keruh."), [row()], "nei-test")


def test_unknown_source_id_is_rejected():
    invalid = draft()
    invalid["blocks"][0]["source_ids"] = ["unknown"]
    with pytest.raises(ValueError, match="retrieved evidence"):
        validate_answer(invalid, [row()], "nei-test")


def test_provider_schema_stays_in_the_flat_documented_subset():
    assert DRAFT_JSON_SCHEMA["properties"]["blocks"]["items"]["required"] == ["text", "kind", "source_ids"]
    assert '"$ref"' not in json.dumps(DRAFT_JSON_SCHEMA)


def test_provider_schema_converts_to_sdk_shape():
    class Type:
        OBJECT = "OBJECT"
        ARRAY = "ARRAY"
        STRING = "STRING"
    class Schema:
        def __init__(self, **kwargs): self.kwargs = kwargs
    converted = as_genai_schema(DRAFT_JSON_SCHEMA, SimpleNamespace(Type=Type, Schema=Schema))
    assert converted.kwargs["type"] == "OBJECT"


def test_starter_questions_are_navigation_only_and_unique():
    questions = starter_questions("diabetic_retinopathy")
    assert len(questions) == 6
    assert len({item["id"] for item in questions}) == 6
    assert all(set(item) == {"id", "question"} for item in questions)


def test_explicit_followup_keeps_previous_topic():
    query = contextual_query("Penyebabnya?", [{"role": "user", "content": "Apa itu glaukoma?"}], "cataract")
    assert "glaucoma" in query and "cataracts" not in query


def test_answer_uses_one_generation_and_paragraph_contract():
    class FakeRetriever:
        version = "nei-test"
        def search(self, _query, limit=4): return [row()]
    calls = []
    with patch("rag.service.get_retriever", return_value=FakeRetriever()):
        response = answer_question("Apa itu katarak?", [], "cataract", {},
                                   lambda *_: calls.append(1) or json.dumps(draft()))
    assert calls == [1]
    assert response.source_status == "grounded"


def test_evidence_packet_keeps_readable_paragraph_context():
    packet = evidence_payload([row()])[0]
    assert set(packet) == {"id", "title", "heading", "text", "url"}


def test_json_fence_and_singleton_are_normalized():
    assert parse_json('```json\n[{"status":"grounded"}]\n```') == {"status": "grounded"}
