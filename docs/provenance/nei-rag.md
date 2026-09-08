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

Suggested-question chips are deterministic navigation prompts per screening
topic, not cached medical answers. Selecting one sends exactly one normal
grounded chat request. This keeps the first interaction responsive without
manufacturing a clinical answer before the user asks it.

The active citation contract is paragraph-level: the model can select only from
the retrieved source IDs, while the server owns marker placement, URLs, excerpts,
and citation-card metadata. The renderer never receives an opaque source ID as
chat text; bracketed IDs are stripped and any remaining raw ID rejects the model
output. This preserves readable source cards without treating model formatting as
trusted.

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
2. Add only the tested `NAYANA_RAG_VERSION` to the existing Modal secret
   `nayana`.
3. Run `modal deploy modal_app.py` from `apps/inference`.
4. Verify `/v1/health` reports `rag.ready: true` and `citation_mode: "paragraph"`,
   then test one grounded answer, one unsupported answer, suggested questions,
   citation expansion, refresh persistence, and a legacy chat row.

Without `NAYANA_RAG_VERSION`, the existing non-RAG chat remains active. This
provides a deliberate rollback path without deleting a corpus or migration.
