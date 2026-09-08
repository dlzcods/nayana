import json
from types import SimpleNamespace as NS
from unittest.mock import patch

import pytest

from rag.citations import evidence_payload
from rag.stream import ProviderStreamIncomplete, collect_json_stream
from rag.service import suggestion_pack
from rag.common import sources


def chunk(text, finish=None, thought=False):
    return NS(candidates=[NS(content=NS(parts=[NS(text=text, thought=thought)]), finish_reason=finish)])


def test_stream_preserves_spaces_and_excludes_thoughts():
    text = collect_json_stream([chunk('hidden', thought=True), chunk('{"text":"hello '),
                                chunk(' world"}', 'STOP')])
    assert json.loads(text) == {'text': 'hello  world'}


def test_stream_uses_documented_chunk_text_when_parts_are_unavailable():
    response = NS(
        candidates=[NS(content=NS(parts=[]), finish_reason='STOP')],
        text='{"status":"grounded"}',
    )

    assert collect_json_stream([response]) == '{"status":"grounded"}'


@pytest.mark.parametrize('reason', ['MAX_TOKENS', 'SAFETY', None])
def test_incomplete_stream_rejected_before_json_parsing(reason):
    with pytest.raises(ValueError, match='finish_reason'):
        collect_json_stream([chunk('{"text":', reason)])


def test_incomplete_stream_exposes_only_safe_operational_metadata():
    with pytest.raises(ProviderStreamIncomplete) as error:
        collect_json_stream([chunk('{"text":"partial', 'RECITATION')])

    assert error.value.reason == 'RECITATION'
    assert error.value.response_characters == len('{"text":"partial')
    assert 'partial' not in str(error.value)


def test_provider_evidence_packet_excludes_presentation_metadata():
    row = dict(id='chunk:u0', title='Cataracts', heading='Symptoms', text='Source sentence.',
               url='https://example.test', corpus_version='test')

    assert evidence_payload([row]) == [{'id': 'chunk:u0', 'text': 'Source sentence.'}]


def test_seed_resumes_after_failure_without_publishing_partial_pack(tmp_path):
    row = dict(id='chunk', title='Cataracts', heading='Symptoms', text='A complete source sentence.',
               url=sources()[2]['url'], corpus_version='test', fetched_at='2026-09-08')
    retriever = NS(version='test', chunks=[row], search=lambda _: [row])
    calls = []
    commits = []

    def complete(*_):
        index = len(calls) + 1
        calls.append(index)
        if index == 3:
            return '{"broken":'
        return json.dumps(dict(id=f'question-{index}', question=f'Apa penjelasan pertanyaan {index}?',
            response=dict(status='grounded', blocks=[dict(kind='evidence', claims=[
                dict(text='Penjelasan berdasarkan sumber.', evidence_unit_id='chunk:u0')])])) )

    with patch('rag.service.get_retriever', return_value=retriever), patch('rag.service.ARTIFACTS', tmp_path):
        with pytest.raises(json.JSONDecodeError):
            suggestion_pack('cataract', {}, complete, persist=True, checkpoint_commit=lambda: commits.append(1))
        assert len(commits) == 2
        assert not (tmp_path / 'versions/test/suggestions/cataract.json').exists()
        result = suggestion_pack('cataract', {}, complete, persist=True)
        assert len(result) == 6
        assert len(calls) == 7  # two reused items, one failed call, four fresh items
        assert (tmp_path / 'versions/test/suggestions/cataract.json').exists()
