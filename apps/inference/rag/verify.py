"""Local NLI gate for claim-to-evidence entailment."""
from __future__ import annotations

import os
import threading


MODEL_ID = "MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7"
MODEL_PATH = "/root/nli-model"
DEFAULT_ENTAILMENT_THRESHOLD = 0.70
_verifier = None
_lock = threading.Lock()


class ClaimVerifier:
    def __init__(self) -> None:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        self.torch = torch
        path = os.getenv("NAYANA_NLI_MODEL_PATH", MODEL_PATH)
        self.tokenizer = AutoTokenizer.from_pretrained(path, local_files_only=True)
        self.model = AutoModelForSequenceClassification.from_pretrained(path, local_files_only=True)
        self.model.eval()
        labels = {str(label).casefold(): int(index) for index, label in self.model.config.id2label.items()}
        self.entailment_index = next(index for label, index in labels.items() if "entail" in label)
        self.neutral_index = next(index for label, index in labels.items() if "neutral" in label)
        self.contradiction_index = next(index for label, index in labels.items() if "contrad" in label)
        self.threshold = float(os.getenv("NAYANA_NLI_ENTAILMENT_THRESHOLD", DEFAULT_ENTAILMENT_THRESHOLD))
        self._inference_lock = threading.Lock()

    def verify(self, pairs: list[tuple[str, str]]) -> list[bool]:
        if not pairs:
            return []
        # NLI premise is the original English NEI evidence; hypothesis is the
        # Indonesian claim. The model is multilingual and sees only this pair.
        premises = [evidence for _, evidence in pairs]
        hypotheses = [claim for claim, _ in pairs]
        # Modal can serve concurrent ASGI requests. Serialising this small CPU
        # batch prevents competing PyTorch inference from making either user wait.
        with self._inference_lock, self.torch.inference_mode():
            encoded = self.tokenizer(premises, hypotheses, padding=True, truncation=True,
                                     max_length=384, return_tensors="pt")
            scores = self.torch.softmax(self.model(**encoded).logits, dim=-1)
        return [bool(row[self.entailment_index] >= self.threshold
                     and row[self.entailment_index] > row[self.neutral_index]
                     and row[self.entailment_index] > row[self.contradiction_index]) for row in scores]


def get_claim_verifier() -> ClaimVerifier:
    global _verifier
    with _lock:
        if _verifier is None:
            _verifier = ClaimVerifier()
    return _verifier
