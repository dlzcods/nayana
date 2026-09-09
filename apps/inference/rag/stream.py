"""Collect typed provider stream blocks without exposing model thoughts."""
from dataclasses import dataclass


class ProviderStreamIncomplete(ValueError):
    """A provider stopped before yielding a usable structured response.

    This keeps the finish reason available for safe operational telemetry while
    deliberately excluding the user question, retrieved evidence, and partial
    provider output from logs.
    """

    def __init__(self, reason: str | None, response_characters: int, response_count: int,
                 text_part_count: int, thought_part_count: int) -> None:
        self.reason = reason or "missing"
        self.response_characters = response_characters
        self.response_count = response_count
        self.text_part_count = text_part_count
        self.thought_part_count = thought_part_count
        super().__init__(f"Incomplete provider response: finish_reason={self.reason}")


@dataclass(frozen=True)
class CollectedProviderText:
    """Only answer text is retained; thought bodies are intentionally discarded."""

    text_parts: tuple[str, ...]
    thought_part_count: int
    response_count: int
    text_part_count: int

    @property
    def text(self) -> str:
        return "".join(self.text_parts)


def collect_json_stream(stream) -> CollectedProviderText:
    parts: list[str] = []
    thought_part_count = 0
    response_count = 0
    text_part_count = 0
    reason = None
    for response in stream:
        response_count += 1
        candidates = getattr(response, "candidates", None) or []
        if len(candidates) > 1:
            raise ValueError("Expected one response candidate")
        text_in_candidate = False
        for candidate in candidates:
            finish = getattr(candidate, "finish_reason", None)
            if finish:
                reason = getattr(finish, "value", str(finish)).split(".")[-1]
            for part in getattr(getattr(candidate, "content", None), "parts", None) or []:
                if getattr(part, "thought", False):
                    thought_part_count += 1
                elif getattr(part, "text", None):
                    parts.append(part.text)
                    text_part_count += 1
                    text_in_candidate = True
        # Never fall back to response.text when a candidate exists. Some
        # providers expose thought text through that convenience property even
        # when candidate parts are correctly marked as thoughts.
        if not candidates and getattr(response, "text", None):
            parts.append(response.text)
            text_part_count += 1
    if reason != "STOP":
        raise ProviderStreamIncomplete(reason, len("".join(parts)), response_count,
                                       text_part_count, thought_part_count)
    text = "".join(parts)
    if not text.strip():
        raise ValueError("Provider returned no answer text")
    return CollectedProviderText(tuple(parts), thought_part_count, response_count, text_part_count)
