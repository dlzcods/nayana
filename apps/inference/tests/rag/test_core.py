import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from rag.citations import (ANSWER_JSON_SCHEMA, EVIDENCE_REFERENCE_MODE, as_genai_schema,
                           attribute_answer, display_sentences, evidence_payload, parse_answer, parse_json)
from rag.common import sources
from rag.retrieve import TinyBM25, allowed_source_ids, contextual_query
from rag.service import answer_question, starter_questions


def row():
    return {
        "id": "cataracts-overview", "source_id": "cataracts", "title": "Cataracts",
        "heading": "What are cataracts?", "text": "A cataract is a cloudy area in the lens of your eye. It can make your vision blurry.",
        "url": sources()[2]["url"], "corpus_version": "nei-test", "fetched_at": "2026-09-08",
    }


def test_allowlist_exactly_five():
    assert len(sources()) == 5
    assert len({item["url"] for item in sources()}) == 5


def test_model_evidence_payload_has_no_server_ids_or_aliases():
    packet = evidence_payload([row()])
    assert set(packet[0]) == {"title", "heading", "text", "url"}
    assert "cataracts-overview" not in json.dumps(packet)
    assert "E1" not in json.dumps(packet)


def test_schema_is_single_answer_field():
    assert ANSWER_JSON_SCHEMA["required"] == ["answer"]
    assert ANSWER_JSON_SCHEMA["properties"] == {"answer": {"type": "string"}}
    assert EVIDENCE_REFERENCE_MODE == "server_attribution"


def test_server_attribution_uses_verbatim_quote_and_server_marker():
    result = attribute_answer(
        "Katarak adalah area keruh pada lensa mata.", [row()], "nei-test",
        threshold=0.1, scorer=lambda _paragraph, quotes, _encoder: [0.9] + [0.1] * (len(quotes) - 1),
    )
    claim = result.citations[0].claims[0]
    assert result.answer.endswith("[1:1]")
    assert claim.supporting_quotes[0] in row()["text"]


def test_low_confidence_keeps_prose_without_false_exact_marker():
    result = attribute_answer(
        "Katarak dapat berkaitan dengan banyak hal.", [row()], "nei-test",
        threshold=0.9, scorer=lambda _paragraph, quotes, _encoder: [0.2] * len(quotes),
    )
    assert "[1:" not in result.answer
    assert result.citations[0].claims == []


def test_server_marks_each_supported_sentence_not_the_whole_paragraph():
    result = attribute_answer(
        "Katarak adalah area keruh pada lensa mata. Katarak dapat membuat penglihatan buram.",
        [row()], "nei-test", threshold=0.1,
        scorer=lambda _sentence, quotes, _encoder: [0.9] + [0.1] * (len(quotes) - 1),
    )
    assert result.answer == ("Katarak adalah area keruh pada lensa mata. [1:1] "
                             "Katarak dapat membuat penglihatan buram. [1:2]")
    assert len(result.citations[0].claims) == 2


def test_sentence_split_keeps_specialist_abbreviation_in_its_sentence():
    assert display_sentences("Diskusikan dengan Sp.M. untuk pemeriksaan lebih lanjut.") == [
        "Diskusikan dengan Sp.M. untuk pemeriksaan lebih lanjut."
    ]


def test_named_disease_source_guard_excludes_other_diseases():
    assert allowed_source_ids("Apakah glaukoma bisa sembuh?") == {"glaucoma"}
    assert allowed_source_ids("Bagaimana menjaga mata sehat?") is None


def test_tiny_bm25_promotes_exact_heading_terms():
    ranking = TinyBM25([
        {"title": "Glaucoma", "heading": "What is the treatment for glaucoma?", "text": "Eye drops."},
        {"title": "Cataracts", "heading": "What are cataracts?", "text": "Cloudy lens."},
    ]).rank("glaucoma treatment")
    assert ranking[0][1] == 0


def test_parse_rejects_protocol_artifacts_in_visible_answer():
    with pytest.raises(ValueError, match="provenance"):
        parse_answer('{"answer":"Jawaban [E1]"}')


def test_provider_schema_converts_to_sdk_shape():
    class Type:
        OBJECT = "OBJECT"
        ARRAY = "ARRAY"
        STRING = "STRING"
    class Schema:
        def __init__(self, **kwargs): self.kwargs = kwargs
    converted = as_genai_schema(ANSWER_JSON_SCHEMA, SimpleNamespace(Type=Type, Schema=Schema))
    assert converted.kwargs["required"] == ["answer"]


def test_starter_questions_are_navigation_only_and_unique():
    questions = starter_questions("diabetic_retinopathy")
    assert len(questions) == 6
    assert len({item["id"] for item in questions}) == 6


def test_explicit_followup_keeps_previous_topic():
    query = contextual_query("Penyebabnya?", [{"role": "user", "content": "Apa itu glaukoma?"}], "cataract")
    assert "glaucoma" in query and "cataracts" not in query


def test_answer_uses_one_generation_then_server_attribution():
    class FakeRetriever:
        version = "nei-test"
        def search(self, _query, limit=4): return [row()]
    calls = []
    def complete(_instruction, payload, schema):
        calls.append((payload, schema))
        return json.dumps({"answer": "Katarak adalah area keruh pada lensa mata."})
    with patch("rag.service.get_retriever", return_value=FakeRetriever()):
        response = answer_question("Apa itu katarak?", [], "cataract", {}, complete)
    assert len(calls) == 1
    assert "cataracts-overview" not in calls[0][0]
    assert calls[0][1] == ANSWER_JSON_SCHEMA
    assert response.source_status == "grounded"


def test_json_fence_and_singleton_are_normalized():
    assert parse_json('```json\n[{"answer":"ok"}]\n```') == {"answer": "ok"}
