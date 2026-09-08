from types import SimpleNamespace as NS

import pytest

from rag.stream import ProviderStreamIncomplete, collect_json_stream


def chunk(text, finish=None, thought=False):
    return NS(candidates=[NS(content=NS(parts=[NS(text=text, thought=thought)]), finish_reason=finish)])


def test_stream_preserves_spaces_and_excludes_thoughts():
    text = collect_json_stream([chunk("hidden", thought=True), chunk('{"text":"hello '), chunk(' world"}', "STOP")])
    assert text == '{"text":"hello  world"}'


def test_incomplete_stream_exposes_safe_operational_metadata_only():
    with pytest.raises(ProviderStreamIncomplete) as error:
        collect_json_stream([chunk('{"text":"partial', "RECITATION")])
    assert error.value.reason == "RECITATION"
    assert "partial" not in str(error.value)
