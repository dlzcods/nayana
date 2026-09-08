"""Collect one complete provider candidate without modifying JSON fragments."""


class ProviderStreamIncomplete(ValueError):
    """A provider stopped before yielding a usable structured response.

    This keeps the finish reason available for safe operational telemetry while
    deliberately excluding the user question, retrieved evidence, and partial
    provider output from logs.
    """

    def __init__(self, reason: str | None, response_characters: int) -> None:
        self.reason = reason or "missing"
        self.response_characters = response_characters
        super().__init__(f"Incomplete provider response: finish_reason={self.reason}")


def collect_json_stream(stream):
    parts = []
    reason = None
    for response in stream:
        candidates = getattr(response, "candidates", None) or []
        if len(candidates) > 1:
            raise ValueError("Expected one response candidate")
        text_in_candidate = False
        for candidate in candidates:
            finish = getattr(candidate, "finish_reason", None)
            if finish:
                reason = getattr(finish, "value", str(finish)).split(".")[-1]
            for part in getattr(getattr(candidate, "content", None), "parts", None) or []:
                if not getattr(part, "thought", False) and getattr(part, "text", None):
                    parts.append(part.text)
                    text_in_candidate = True
        # The SDK's documented streaming example reads `chunk.text`. Use it
        # only when candidate parts are unavailable, avoiding duplicate text.
        if not text_in_candidate and getattr(response, "text", None):
            parts.append(response.text)
    if reason != "STOP":
        raise ProviderStreamIncomplete(reason, len("".join(parts)))
    text = "".join(parts)
    if not text.strip():
        raise ValueError("Provider returned no answer text")
    return text
