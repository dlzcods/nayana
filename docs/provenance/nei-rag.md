# NEI-grounded chat corpus

NAYANA uses a deliberately small retrieval corpus for educational chat. It is
not used to classify a fundus image, generate the executive summary, diagnose a
condition, or replace an ophthalmologist (Sp.M).

## Approved sources

Only these five National Eye Institute (NEI/NIH) pages are accepted by the
scraper and by the client-side citation link validator:

1. [Keep Your Eyes Healthy](https://www.nei.nih.gov/eye-health-information/healthy-vision/how-eyes-work/keep-your-eyes-healthy)
2. [8 Things You Can Do Right Now to Protect Your Vision](https://www.nei.nih.gov/eye-health-information/healthy-vision/8-things-you-can-do-right-now-protect-your-vision)
3. [Cataracts](https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/cataracts)
4. [Diabetic Retinopathy](https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/diabetic-retinopathy)
5. [Glaucoma](https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/glaucoma)

Research-news listings, linked subpages, navigation, feedback forms, and other
site modules are excluded. NAYANA is not affiliated with or endorsed by NEI.
Citation panels preserve the source URL, article heading, original English
excerpt, fetch date, update date when exposed by the page, corpus version, and
the attribution `Courtesy: National Eye Institute, National Institutes of
Health (NEI/NIH).`

## Reproducible pipeline

From `apps/inference`, create a Python 3.11 environment for scraping. Keep the
Firecrawl key in the shell environment; never put it in Git or a frontend
variable.

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install pydantic certifi pytest
export FIRECRAWL_API_KEY="your-key"
python -m rag.scrape --dry-run
python -m rag.scrape
modal run modal_rag_build.py
```

The scraper requires every returned canonical URL to match the allowlist and
publishes no partial corpus. Raw snapshot hashes become part of the immutable
version. Preparation targets 1,500 characters with a maximum 300-character
overlap while checking the actual tokenizer limit of 512 tokens. Documents use
the E5 `passage:` prefix and questions use `query:`.

The remote builder pins `intfloat/multilingual-e5-small` to its resolved Hugging
Face revision, embeds to 384 dimensions, normalizes vectors, and writes a FAISS
`IndexFlatIP`. Encoder, index, and chunk hashes are verified when loaded. A
candidate version is never enabled automatically.

## Grounding and safety contract

Gemma receives only retrieved snippets, bounded conversation context, and the
non-medical screening context. Medical paragraphs must identify retrieved chunk
IDs. The server—not Gemma—attaches URLs, excerpts, and numbered references. If
the available evidence does not answer a question, the API returns
`insufficient_evidence` without citations. It also rejects model-supplied URLs,
unknown source IDs, citation markers, personalized doses, and unsupported local
facts such as current treatment prices.

In legacy mode, suggested questions are generated as one six-item grounded pack,
cached on the backend for one hour, and briefly reused in the browser. Duplicate
requests for the same result are coalesced; unrelated categories are not
serialized behind a global generation lock.

Before production deploy, seed and validate each topic separately. Separate
commands keep progress observable and make a provider timeout retryable without
redoing the other topics:

```bash
modal run modal_rag_check.py --version VERSION --suggestions-only --seed-topic cataract
modal run modal_rag_check.py --version VERSION --suggestions-only --seed-topic diabetic_retinopathy
modal run modal_rag_check.py --version VERSION --suggestions-only --seed-topic glaucoma
modal run modal_rag_check.py --version VERSION --suggestions-only --seed-topic normal
```

The production image requires these validated files and fails fast if a topic
is missing instead of leaving the UI waiting through a long cold generation.

## Reversible atomic citation experiment

Atomic citation mode is selected by the application-code constant
`ACTIVE_CITATION_MODE = ATOMIC_CITATION_MODE`. It keeps the parent
RAG version and its legacy chunks/index immutable, then builds a sibling
`atomic-citations-v1` artifact containing sentence/list-item source spans with
permanent `source_unit_id` values. The atomic index reuses the saved encoder and
does not add a hosted vector database or external search service.

In this mode, six suggested-question chips are deterministic navigation prompts,
not cached medical answers. Selecting one sends exactly one normal grounded chat
request. The model receives at most three retrieved atomic source units and may
attach each short Indonesian claim only to an ID in that packet. Server-side
validation then owns marker placement and the citation-card source span.

Build the atomic artifact before enabling the flag. The output reports both
legacy `hit_at_4` and atomic `article_hit_at_3` plus heading-sensitive `hit_at_3`; inspect the held-out atomic scores and
the saved `atomic-citations-v1/retrieval-evaluation.json` before moving on.

```bash
modal run modal_rag_build.py
```

Do not enable the mode until its evaluation and manual UAT pass. Rollback is
non-destructive: set `ACTIVE_CITATION_MODE = LEGACY_CITATION_MODE` in
`rag/service.py` and deploy `modal_app.py`; no corpus, chat, or Supabase data is deleted.

## Evaluation boundary

`tests/rag/cases.jsonl` contains 40 retrieval cases: 30 development and 10 held
out, including Indonesian questions, typos, follow-ups, unsupported requests,
and prompt injection. `modal_rag_check.py` adds synthetic live generation checks
for evidence use, abstention, urgent wording, application context, and the
six-question pack. These are engineering grounding checks, not clinical
validation or evidence that model output is medically infallible.

## Production activation

Activation is intentionally manual and ordered:

1. Apply `apps/supabase/migrations/20260906_0007_chat_citations.sql`.
2. For legacy mode, seed all four topic packs with the commands above. For
   atomic mode, build the separate atomic artifact instead.
3. Add only the tested `NAYANA_RAG_VERSION` to the existing Modal secret
   `nayana`; the citation mode is selected in code.
4. Run `modal deploy modal_app.py` from `apps/inference`.
5. Verify `/v1/health` reports `rag.ready: true` and the expected citation mode,
   then test one grounded answer, one unsupported answer, suggested questions,
   citation expansion, refresh persistence, and a legacy chat row.

Without `NAYANA_RAG_VERSION`, the existing non-RAG chat remains active. This
provides a deliberate rollback path without deleting a corpus or migration.
