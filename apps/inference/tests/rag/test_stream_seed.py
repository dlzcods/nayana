from types import SimpleNamespace as NS

import pytest

from rag.stream import ProviderStreamIncomplete, collect_json_stream


def chunk(text, finish=None, thought=False):
    return NS(candidates=[NS(content=NS(parts=[NS(text=text, thought=thought)]), finish_reason=finish)])


def test_stream_preserves_spaces_and_excludes_thoughts():
    collected = collect_json_stream([chunk("hidden", thought=True), chunk('{"text":"hello '), chunk(' world"}', "STOP")])
    assert collected.text == '{"text":"hello  world"}'
    assert collected.thought_part_count == 1


def test_stream_never_falls_back_to_convenience_text_when_only_thought_parts_exist():
    response = NS(candidates=[NS(content=NS(parts=[NS(text="hidden", thought=True)]), finish_reason="STOP")],
                  text='{"answer":"thought leak"}')
    with pytest.raises(ValueError, match="no answer text"):
        collect_json_stream([response])


def test_incomplete_stream_exposes_safe_operational_metadata_only():
    with pytest.raises(ProviderStreamIncomplete) as error:
        collect_json_stream([chunk('{"text":"partial', "RECITATION")])
    assert error.value.reason == "RECITATION"
    assert "partial" not in str(error.value)
