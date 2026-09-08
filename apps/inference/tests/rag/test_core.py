import json
import re
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from rag.citations import (DRAFT_JSON_SCHEMA, LEGACY_DRAFT_JSON_SCHEMA, SUGGESTION_ITEM_JSON_SCHEMA,
                           SUGGESTION_PACK_JSON_SCHEMA, as_genai_schema, evidence_units_from_rows,
                           parse_json, validate_answer, validate_legacy_answer)
from rag.common import digest, sources
from rag.prepare import sections, split_text, token_count
from rag.atomic import _sentences
from rag.retrieve import (HEADING_INTENTS, _select_diverse_atomic_units,
                          _sort_atomic_ranked, contextual_query)
from rag.service import (ATOMIC_CITATION_MODE, LEGACY_CITATION_MODE, answer_question, atomic_starter_questions,
                         citation_mode, load_cached_suggestions, persist_suggestions,
                         suggestion_pack, validate_cached_suggestions)


class Tokenizer:
    def encode(self, text, **kwargs):
        return list(text) + [0, 0]


def evidence():
    return [{"id": "chunk1", "title": "Cataracts", "heading": "Causes",
             "text": "Original NEI source sentence with complete evidence.",
             "url": sources()[2]["url"], "corpus_version": "nei-test", "fetched_at": "2026-09-06"}]


def units(rows=None):
    return evidence_units_from_rows(rows or evidence())


def claim(text="Penjelasan edukatif.", unit_id="chunk1:u0"):
    return {"text": text, "evidence_unit_id": unit_id}


def draft(unit_id="chunk1:u0"):
    return {"status": "grounded", "blocks": [{"kind": "evidence", "claims": [claim(unit_id=unit_id)]}]}


def supported(pairs):
    return [True] * len(pairs)


def test_allowlist_exactly_five():
    assert len(sources()) == 5
    assert len({row["url"] for row in sources()}) == 5
    assert all("research-and-training" not in row["url"] for row in sources())


def test_modules_excluded_but_warnings_preserved():
    text = "Site banner\n# Cataracts\n## Symptoms\n" + "Blurry vision. Other conditions may cause similar symptoms. " * 10
    text += "\n## Research News\nMouse experiment\n### New drug\nExperimental\n## Have a Question?\nContact us"
    title, rows, _ = sections(text)
    assert title == "Cataracts" and len(rows) == 1
    assert "Other conditions" in rows[0]["text"] and "experiment" not in str(rows)


def test_feedback_form_and_what_is_latest_research_are_excluded():
    text = "# Keep Your Eyes Healthy\n## Protect your eyes\n" + ("Useful guidance that must remain in the article. " * 8)
    text += '\nWas this page helpful?\nSelect "Yes" or "No." Add comments.\nPrivate form text'
    title, rows, _ = sections(text)
    assert title == "Keep Your Eyes Healthy"
    assert "Useful guidance" in rows[0]["text"] and "Private form" not in str(rows)


def test_chunks_cover_input_without_silent_truncation():
    text = "Sentence with a warning. " * 200
    chunks = split_text(text, "passage: Test > Warning\n", Tokenizer())
    covered = set()
    for piece, start, end in chunks:
        covered.update(range(start, end))
        assert token_count(Tokenizer(), "passage: Test > Warning\n" + piece) <= 512
        assert end - start <= 1500
    assert all(i in covered for i, char in enumerate(text) if not char.isspace())


def test_server_owns_full_atomic_evidence_units():
    rows = evidence()
    rows[0]["text"] = "First complete sentence. Second complete sentence.\n\n- A complete bullet item."
    assert [row["text"] for row in units(rows)] == [
        "First complete sentence.", "Second complete sentence.", "- A complete bullet item.",
    ]


def test_atomic_source_unit_is_preserved_without_a_second_split():
    row = {**evidence()[0], "id": "cataracts-atomic-1", "source_unit_id": "cataracts-atomic-1",
           "text": "One complete source sentence. A second sentence in the same source unit."}
    assert evidence_units_from_rows([row]) == [{
        "id": "cataracts-atomic-1", "chunk_id": "cataracts-atomic-1", "title": "Cataracts",
        "heading": "Causes", "text": row["text"], "url": row["url"], "corpus_version": "nei-test",
        "source_updated_at": None, "fetched_at": "2026-09-06", "source_start": None, "source_end": None,
    }]


def test_atomic_sentence_split_keeps_full_list_items_and_sentences():
    assert _sentences("First sentence. Second sentence.\n\n- A full list item.") == [
        "First sentence.", "Second sentence.", "- A full list item.",
    ]


def test_atomic_heading_intents_cover_the_six_observed_retrieval_misses():
    expected = (
        ("Apa itu katarak?", "What are cataracts?"),
        ("Bagaimana dokter memeriksa katarak?", "How is cataract checked?"),
        ("Pilihan penanganan retinopati diabetik apa saja?", "What is the treatment?"),
        ("Glaukoma awal bisa nggak berasa apa-apa?", "What are the symptoms?"),
    )
    for question, heading in expected:
        assert any(re.search(question_pattern, question, re.I)
                   and re.search(heading_pattern, heading, re.I)
                   for question_pattern, heading_pattern in HEADING_INTENTS)


def test_atomic_diversification_does_not_spend_two_slots_on_one_heading_first():
    source_units = [
        {"source_id": "dr", "heading": "At a glance"},
        {"source_id": "dr", "heading": "At a glance"},
        {"source_id": "dr", "heading": "Treatment"},
        {"source_id": "dr", "heading": "Prevention"},
    ]
    ranked = [(False, 0.90, 0.90, 0), (False, 0.89, 0.89, 1),
              (False, 0.80, 0.80, 2), (False, 0.79, 0.79, 3)]
    assert [index for _, index in _select_diverse_atomic_units(ranked, source_units, 3)] == [0, 2, 3]


def test_atomic_explicit_heading_intent_beats_a_more_similar_but_wrong_section():
    ranked = _sort_atomic_ranked([
        (False, 0.92, 0.92, 0),  # risk sentence with a stronger raw embedding score
        (True, 0.74, 0.56, 1),   # exact examination heading
    ])
    assert [index for _, _, _, index in ranked] == [1, 0]


def test_atomic_starter_questions_are_navigation_only_and_unique():
    questions = atomic_starter_questions("diabetic_retinopathy")
    assert len(questions) == 6
    assert len({item["id"] for item in questions}) == 6
    assert all(set(item) == {"id", "question"} for item in questions)


def test_citation_mode_is_code_selected_and_rejects_invalid_release_setting():
    assert citation_mode() == LEGACY_CITATION_MODE
    with patch("rag.service.ACTIVE_CITATION_MODE", "unsupported"), pytest.raises(RuntimeError):
        citation_mode()


def test_provider_schema_stays_within_the_documented_flat_subset():
    encoded = json.dumps(DRAFT_JSON_SCHEMA)
    assert '"$defs"' not in encoded and '"$ref"' not in encoded and '"anyOf"' not in encoded
    assert DRAFT_JSON_SCHEMA["type"] == "object"
    assert DRAFT_JSON_SCHEMA["properties"]["blocks"]["items"]["required"] == ["kind", "text", "claims"]
    assert LEGACY_DRAFT_JSON_SCHEMA["properties"]["blocks"]["items"]["required"] == ["text", "kind", "source_ids"]
    assert SUGGESTION_PACK_JSON_SCHEMA["properties"]["questions"]["required"] == [
        "item_1", "item_2", "item_3", "item_4", "item_5", "item_6"
    ]


def test_provider_schema_converts_to_the_sdk_shape_from_the_documentation():
    class Type:
        OBJECT = "OBJECT"
        ARRAY = "ARRAY"
        STRING = "STRING"
    class Schema:
        def __init__(self, **kwargs): self.kwargs = kwargs
    converted = as_genai_schema(DRAFT_JSON_SCHEMA, SimpleNamespace(Type=Type, Schema=Schema))
    assert converted.kwargs["type"] == "OBJECT"
    assert converted.kwargs["property_ordering"] == ["status", "blocks"]
    assert converted.kwargs["properties"]["blocks"].kwargs["type"] == "ARRAY"


def test_same_source_number_reused_with_distinct_claim_markers():
    value = {"status": "grounded", "blocks": [
        {"kind": "evidence", "claims": [claim("Klaim pertama.")]},
        {"kind": "evidence", "claims": [claim("Klaim kedua.")]},
    ]}
    response = validate_answer(value, units(), "nei-test", supported)
    assert len(response.citations) == 1
    assert "[1:1]" in response.answer and "[1:2]" in response.answer
    assert all(item.excerpt == evidence()[0]["text"] for item in response.citations[0].claims)


def test_chunks_from_one_article_coalesce_into_one_reference():
    first = evidence()[0]
    second = {**first, "id": "chunk2", "heading": "Symptoms", "text": "Second original source sentence."}
    value = {"status": "grounded", "blocks": [
        {"kind": "evidence", "claims": [claim("Pertama.", "chunk1:u0")]},
        {"kind": "evidence", "claims": [claim("Kedua.", "chunk2:u0")]},
    ]}
    response = validate_answer(value, units([first, second]), "nei-test", supported)
    assert len(response.citations) == 1 and response.citations[0].sections == ["Causes", "Symptoms"]


def test_model_cannot_supply_quote_or_unknown_evidence_unit():
    invalid = draft()
    invalid["blocks"][0]["claims"][0]["supporting_quotes"] = ["Invented quote."]
    with pytest.raises(ValueError):
        validate_answer(invalid, units(), "nei-test", supported)
    with pytest.raises(ValueError, match="retrieved evidence unit"):
        validate_answer(draft("fabricated:u0"), units(), "nei-test", supported)


def test_each_claim_keeps_its_own_exact_source_unit():
    rows = evidence()
    rows[0]["heading"] = "Protect your eyes"
    rows[0]["text"] = (
        "Wear sunglasses. Be sure to look for sunglasses that block 99 to 100 percent of both UVA and UVB radiation. "
        "Quit smoking. Smoking can harm your eyes and increase your risk of eye diseases. "
        "Rest your eyes. Follow the 20-20-20 rule when you use a screen for a long time."
    )
    value = {"status": "grounded", "blocks": [{"kind": "evidence", "claims": [
        claim("Kacamata hitam dapat melindungi mata dari UVA dan UVB.", "chunk1:u1"),
        claim("Berhenti merokok dapat mengurangi risiko gangguan mata.", "chunk1:u3"),
        claim("Jeda 20-20-20 dapat digunakan saat memakai layar lama.", "chunk1:u5"),
    ]}]}
    response = validate_answer(value, units(rows), "nei-test", supported)
    assert [item.supporting_quotes[0] for item in response.citations[0].claims] == [
        "Be sure to look for sunglasses that block 99 to 100 percent of both UVA and UVB radiation.",
        "Smoking can harm your eyes and increase your risk of eye diseases.",
        "Follow the 20-20-20 rule when you use a screen for a long time.",
    ]


def test_unsupported_claim_is_omitted_not_repaired_or_returned():
    rows = evidence()
    rows[0]["text"] = "Supported source sentence. Unsupported source sentence."
    value = {"status": "grounded", "blocks": [{"kind": "evidence", "claims": [
        claim("Klaim yang didukung.", "chunk1:u0"), claim("Klaim yang harus dihapus.", "chunk1:u1"),
    ]}]}
    response = validate_answer(value, units(rows), "nei-test", lambda _pairs: [True, False])
    assert "didukung" in response.answer and "harus dihapus" not in response.answer
    assert len(response.citations[0].claims) == 1


def test_one_generation_only_and_bad_output_is_honest_insufficient():
    row = {**evidence()[0], "source_id": "cataracts", "topic": "cataract", "score": .8, "start": 0, "end": 10}
    class FakeRetriever:
        version = "nei-test"; chunks = [row]
        def search(self, _query, limit=3): return [row]
    calls = []
    # The released implementation selects the atomic retriever in code. The
    # fixture intentionally returns an unknown evidence ID, so this must still
    # make exactly one provider call and fail closed rather than invent a claim.
    with patch("rag.service.ACTIVE_CITATION_MODE", ATOMIC_CITATION_MODE), \
         patch("rag.service.get_atomic_retriever", return_value=FakeRetriever()):
        response = answer_question("Tolong jelaskan", [], "cataract", {},
                                   lambda *_: calls.append(1) or json.dumps(draft("unknown:u0")), supported)
    assert calls == [1] and response.source_status == "insufficient_evidence"


def test_atomic_mode_uses_only_atomic_source_ids_for_claims():
    row = {**evidence()[0], "id": "cataracts-atomic-1", "source_unit_id": "cataracts-atomic-1",
           "source_id": "cataracts", "topic": "cataract", "score": .8, "start": 0, "end": 10}
    calls = []

    class FakeAtomicRetriever:
        version = "nei-test"

        def search(self, _query, limit=3):
            calls.append(limit)
            return [row]

    with patch("rag.service.ACTIVE_CITATION_MODE", ATOMIC_CITATION_MODE), \
         patch("rag.service.get_atomic_retriever", return_value=FakeAtomicRetriever()):
        response = answer_question(
            "Apa gejala katarak?", [], "cataract", {},
            lambda *_: json.dumps(draft("cataracts-atomic-1")), supported,
        )
    assert calls == [3]
    assert response.source_status == "grounded"
    assert response.citations[0].claims[0].source_chunk_id == "cataracts-atomic-1"


def test_legacy_paragraph_contract_attaches_one_article_marker_per_paragraph():
    value = {"status": "grounded", "blocks": [{
        "kind": "evidence", "text": "Penjelasan paragraf yang didukung sumber.", "source_ids": ["chunk1"],
    }]}
    response = validate_legacy_answer(value, evidence(), "nei-test")
    assert response.answer.endswith("[1]")
    assert response.citations[0].claims == []


@pytest.mark.parametrize("value", [
    {"status": "grounded", "blocks": [{"kind": "evidence", "claims": []}]},
    {"status": "grounded", "blocks": [{"kind": "evidence", "claims": [claim("See https://fake.test")]}]},
    {"status": "grounded", "blocks": [{"kind": "evidence", "claims": [claim("Source [9]")]}]},
])
def test_invalid_citations_rejected(value):
    with pytest.raises(ValueError):
        validate_answer(value, units(), "nei-test", supported)


def test_wrong_version_rejected():
    with pytest.raises(ValueError):
        validate_answer(draft(), units(), "nei-other", supported)


def test_insufficient_does_not_invent_sources():
    response = validate_answer({"status": "insufficient_evidence", "blocks": []}, units(), "nei-test", supported)
    assert response.citations == [] and response.source_status == "insufficient_evidence"


def test_singleton_json_and_fences():
    assert parse_json('```json\n[{"status":"grounded"}]\n```') == {"status": "grounded"}


def test_followup_uses_latest_explicit_topic_not_prediction():
    query = contextual_query("Penyebabnya?", [{"role": "user", "content": "Apa itu glaukoma?"}], "cataract")
    assert "glaucoma" in query and "cataracts" not in query


def test_followup_expands_examination_intent():
    query = contextual_query("Terus diperiksanya seperti apa?", [{"role": "user", "content": "Retinopati diabetik"}], "cataract")
    assert "diabetic retinopathy" in query and "dilated eye exam" in query


def test_general_question_not_forced_to_prediction():
    query = contextual_query("Cara menjaga mata sehat?", [], "cataract")
    assert "healthy vision" in query and "cataracts" not in query


def test_missing_article_fails_closed(tmp_path):
    from rag.prepare import prepare
    with patch("rag.prepare.ARTIFACTS", tmp_path), pytest.raises(FileNotFoundError):
        prepare(Tokenizer())


def _suggestion_row():
    return {**evidence()[0], "source_id": "cataracts", "topic": "cataract", "score": .9,
            "start": 0, "end": 10, "embedding_text": "passage", "token_count": 5}


def test_suggestion_pack_accepts_strict_direct_array():
    row = _suggestion_row()
    class FakeRetriever:
        version = "nei-test"
        def search(self, _query): return [row]
    payload = [{"id": f"question-{i}", "question": f"Apa penjelasan lanjutan nomor {i}?", "response": draft()} for i in range(6)]
    schemas = []
    def complete(_instruction, _payload, schema=None):
        schemas.append(schema)
        return json.dumps(payload[len(schemas) - 1])
    with patch("rag.service.get_retriever", return_value=FakeRetriever()):
        result = suggestion_pack("cataract", {}, complete)
    assert len(result) == 6 and all(item["citations"][0]["url"] == sources()[2]["url"] for item in result)
    assert schemas == [SUGGESTION_ITEM_JSON_SCHEMA] * 6


def test_persisted_suggestions_verify_checksum_and_atomic_provenance(tmp_path):
    row = _suggestion_row()
    class FakeRetriever:
        version = "nei-test"; chunks = [{key: value for key, value in row.items() if key != "corpus_version"}]
        def search(self, _query): return [row]
    payload = [{"id": f"question-{i}", "question": f"Apa penjelasan lanjutan nomor {i}?", "response": draft()} for i in range(6)]
    calls = 0
    def complete(_instruction, _payload, _schema=None):
        nonlocal calls
        value = payload[calls]
        calls += 1
        return json.dumps(value)
    with patch("rag.service.get_retriever", return_value=FakeRetriever()):
        generated = suggestion_pack("cataract", {}, complete)
    with patch("rag.service.ARTIFACTS", tmp_path):
        persist_suggestions("cataract", generated, FakeRetriever())
        assert load_cached_suggestions("cataract", FakeRetriever()) == generated
        checksum = tmp_path / "versions/nei-test/suggestions/cataract.sha256.json"
        checksum.write_text('{"sha256":"wrong"}')
        with pytest.raises(ValueError, match="integrity"):
            load_cached_suggestions("cataract", FakeRetriever())


def test_seed_replaces_invalid_cached_pack_but_runtime_rejects_it(tmp_path):
    row = _suggestion_row()
    class FakeRetriever:
        version = "nei-test"; chunks = [{key: value for key, value in row.items() if key != "corpus_version"}]
        def search(self, _query): return [row]
    payload = [{"id": f"question-{i}", "question": f"Apa penjelasan lanjutan nomor {i}?", "response": draft()} for i in range(6)]
    calls = 0
    def complete(_instruction, _payload, _schema=None):
        nonlocal calls
        value = payload[calls]
        calls += 1
        return json.dumps(value)
    with patch("rag.service.get_retriever", return_value=FakeRetriever()), patch("rag.service.ARTIFACTS", tmp_path):
        path = tmp_path / "versions/nei-test/suggestions/cataract.json"
        path.parent.mkdir(parents=True)
        path.write_text('not-json')
        path.with_suffix(".sha256.json").write_text(json.dumps({"sha256": digest(path.read_bytes())}))
        with pytest.raises(ValueError):
            suggestion_pack("cataract", {}, lambda *_: json.dumps(payload), use_cache=True)
        rebuilt = suggestion_pack("cataract", {}, complete, use_cache=True, persist=True)
    assert len(rebuilt) == 6


def test_cached_article_citation_accepts_claims_from_multiple_own_chunks():
    first = _suggestion_row()
    second = {**first, "id": "chunk2", "heading": "Symptoms", "text": "A second complete NEI source sentence."}
    response = validate_answer({"status": "grounded", "blocks": [{"kind": "evidence", "claims": [
        claim("Klaim dari bagian penyebab.", "chunk1:u0"),
        claim("Klaim dari bagian gejala.", "chunk2:u0"),
    ]}]}, units([first, second]), "nei-test", supported)
    class FakeRetriever:
        version = "nei-test"
        chunks = [
            {key: value for key, value in first.items() if key != "corpus_version"},
            {key: value for key, value in second.items() if key != "corpus_version"},
        ]
    cached = [{"id": f"question-{i}", "question": f"Apa penjelasan lanjutan nomor {i}?", **response.model_dump()} for i in range(6)]
    assert validate_cached_suggestions(cached, "cataract", FakeRetriever()) == cached
