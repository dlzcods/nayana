import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from rag.citations import (ANSWER_JSON_SCHEMA, EVIDENCE_REFERENCE_MODE, as_genai_schema,
                           MAX_CITATION_CLAIMS, attribute_answer, attribute_verified_sentence, display_sentences,
                           evidence_payload, parse_answer, parse_json)
from rag.common import sources
from rag.retrieve import TinyBM25, allowed_source_ids, contextual_query
from rag.service import answer_question, starter_questions, stream_answer_question
from rag.telemetry import retrieval_metadata
from rag.providers import netra_completion, netra_text_stream, selected_rag_provider


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
    assert set(packet[0]) == {"title", "heading", "text"}
    assert "cataracts-overview" not in json.dumps(packet)
    assert "E1" not in json.dumps(packet)


def test_retrieval_metadata_keeps_operational_counts_not_prompt_text():
    metadata = retrieval_metadata(question="rahasia-pertanyaan", query="query-rahasia",
                                  payload="payload-rahasia", evidence=[row()], memory_intent="overview",
                                  instruction="instruksi-rahasia")
    assert metadata["evidence_count"] == 1
    assert metadata["source_ids"] == ["cataracts"]
    assert metadata["retrieval_candidates"][0]["source_id"] == "cataracts"
    assert "rahasia" not in json.dumps(metadata)


def test_rag_provider_defaults_to_netra_and_rejects_legacy_routes():
    netra = selected_rag_provider({"NETRA_API_KEY": "netra-key"})
    assert (netra.name, netra.model, netra.api_key) == (
        "netra", "deepseek/deepseek-v4-flash-0731", "netra-key",
    )
    with pytest.raises(ValueError, match="must be 'netra'"):
        selected_rag_provider({"NAYANA_RAG_PROVIDER": "gemini"})


def test_netra_stream_forwards_only_content_deltas_and_keeps_reasoning_private():
    class FakeResponse:
        headers = {"X-Request-Id": "netra-request"}
        def __iter__(self):
            yield b'data: {"choices":[{"delta":{"reasoning_content":"private"}}]}\n'
            yield b'\n'
            yield b'data: {"choices":[{"delta":{"content":"Kalimat "}}]}\n'
            yield b'\n'
            yield b'data: {"choices":[{"delta":{"content":"aman."},"finish_reason":"stop"}]}\n'
            yield b'\n'
            yield b'data: [DONE]\n'
            yield b'\n'
        def close(self): pass

    provider = selected_rag_provider({"NAYANA_RAG_PROVIDER": "netra", "NETRA_API_KEY": "netra-key"})
    with patch("rag.providers.urlopen", return_value=FakeResponse()) as request:
        text = "".join(netra_text_stream(
            provider=provider, instruction="instruction", payload="payload",
            timeout_ms=1_000, max_output_tokens=640,
        ))

    body = json.loads(request.call_args.args[0].data)
    assert text == "Kalimat aman."
    assert body["reasoning"] == {"effort": "low", "exclude": True}
    assert body["stream"] is True
    assert body["messages"][1]["content"] == "payload"
    assert request.call_args.args[0].headers["X-netra-agent"] == "nayana-screening-chat"


def test_netra_completion_keeps_the_json_contract_and_excludes_reasoning():
    class FakeResponse:
        headers = {"X-Request-Id": "netra-request"}

        def read(self):
            return b'{"choices":[{"message":{"content":"{\\\"answer\\\":\\\"Aman.\\\"}"}}],"usage":{"total_tokens":12}}'

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    provider = selected_rag_provider({"NAYANA_RAG_PROVIDER": "netra", "NETRA_API_KEY": "netra-key"})
    with patch("rag.providers.urlopen", return_value=FakeResponse()) as request:
        completion = netra_completion(
            provider=provider, instruction="instruction", payload="payload", timeout_ms=1_000,
            max_output_tokens=640, response_schema={"type": "object", "properties": {"answer": {"type": "string"}}},
        )

    body = json.loads(request.call_args.args[0].data)
    assert completion.text == '{"answer":"Aman."}'
    assert completion.route == "netra"
    assert body["reasoning"] == {"effort": "low", "exclude": True}
    assert body["response_format"]["type"] == "json_schema"
    assert body["response_format"]["json_schema"]["strict"] is True


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


def test_verified_sentence_withholds_unproven_prose_and_keeps_marker_ids_stable():
    citations_by_url = {}
    rendered, citations = attribute_verified_sentence(
        "Katarak adalah area keruh pada lensa mata.", [row()], "nei-test",
        citations_by_url=citations_by_url, threshold=0.1,
        scorer=lambda _sentence, quotes, _encoder: [0.9] + [0.1] * (len(quotes) - 1),
    )
    assert rendered == "Katarak adalah area keruh pada lensa mata. [1:1]"
    assert len(citations[0].claims) == 1
    hidden, updated = attribute_verified_sentence(
        "Pola ini selalu membutuhkan operasi.", [row()], "nei-test",
        citations_by_url=citations_by_url, threshold=0.95,
        scorer=lambda _sentence, quotes, _encoder: [0.2] * len(quotes),
    )
    assert hidden is None
    assert len(updated[0].claims) == 1


def test_verified_stream_keeps_a_sentence_when_two_nei_sources_support_it_equally():
    second_source = {
        **row(),
        "id": "healthy-eyes-overview",
        "source_id": "healthy-eyes",
        "url": sources()[0]["url"],
    }
    rendered, citations = attribute_verified_sentence(
        "Katarak adalah area keruh pada lensa mata.", [row(), second_source], "nei-test",
        citations_by_url={}, threshold=0.6,
        scorer=lambda _sentence, quotes, _encoder: [0.75] * len(quotes),
    )
    assert rendered == "Katarak adalah area keruh pada lensa mata. [1:1]"
    assert len(citations) == 1


def test_attribution_caps_claims_per_source_before_response_validation():
    answer = " ".join(f"Katarak adalah area keruh pada lensa mata nomor {index}." for index in range(10))
    result = attribute_answer(
        answer, [row()], "nei-test", threshold=0.1,
        scorer=lambda _sentence, quotes, _encoder: [0.9] + [0.1] * (len(quotes) - 1),
    )
    assert len(result.citations[0].claims) == MAX_CITATION_CLAIMS
    assert f"[1:{MAX_CITATION_CLAIMS}]" in result.answer
    assert f"[1:{MAX_CITATION_CLAIMS + 1}]" not in result.answer


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
        response = answer_question("Apa itu katarak?", [], "cataract",
                                   {"screening_context": {"categories": []}}, complete)
    assert len(calls) == 1
    assert "cataracts-overview" not in calls[0][0]
    assert calls[0][1] == ANSWER_JSON_SCHEMA
    sent = json.loads(calls[0][0])
    assert sent["screening_context"] == {"categories": []}
    assert "screening_context" not in sent["screening_context"]
    assert response.source_status == "grounded"


def test_verified_stream_never_yields_provider_fragments_before_attribution():
    class FakeRetriever:
        version = "nei-test"
        encoder = None
        def search(self, _query, limit=4): return [row()]

    def verified(_sentence, _evidence, _version, *, citations_by_url, **_kwargs):
        citation = citations_by_url.setdefault("source", SimpleNamespace(model_dump=lambda: {"id": 1, "claims": []}))
        return "Katarak adalah area keruh pada lensa mata. [1:1]", [citation]

    with patch("rag.service.get_retriever", return_value=FakeRetriever()), \
         patch("rag.service.attribute_verified_sentence", side_effect=verified):
        events = list(stream_answer_question(
            "Apa itu katarak?", [], "cataract", {"screening_context": {"categories": []}},
            lambda _instruction, _payload: ["Katarak adalah area ", "keruh pada lensa mata. "],
        ))
    assert [event for event, _data in events[:3]] == ["status", "status", "status"]
    sentence = next(data for event, data in events if event == "sentence")
    assert sentence["text"] == "Katarak adalah area keruh pada lensa mata. [1:1]"
    assert "area " not in [data.get("text", "") for event, data in events if event == "status"]


def test_json_fence_and_singleton_are_normalized():
    assert parse_json('```json\n[{"answer":"ok"}]\n```') == {"answer": "ok"}
