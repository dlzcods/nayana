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
`IndexFlatIP`. At serving time, the same immutable `chunks.json` is also loaded
into a tiny in-memory BM25 index. E5 and BM25 ranks are fused with reciprocal
rank fusion (RRF); their raw scores are never mixed. Encoder, index, and chunk
hashes are verified when loaded. A candidate version is never enabled
automatically.

## Grounding and safety contract

Gemma receives only retrieved snippets, bounded conversation context, and the
non-medical screening context. Its schema has one field, `answer`; opaque chunk
IDs, aliases, quote text, and markers never enter its request or response
contract. When a question names cataract, diabetic retinopathy, or glaucoma,
the retriever permits only chunks belonging to that condition; general eye-health
questions remain free to search all five approved articles. After generation,
the server compares every display sentence against short, verbatim candidate
spans from the retrieved NEI chunks using multilingual E5. Candidates are
compared once per article, so overlapping chunks from one article cannot erase a
valid marker. The server alone owns URLs, excerpts, numbered markers, and
quote-card text. If a sentence has no conservative semantic match it receives no
exact-quote marker; this is an honest absence of claim-level proof, not a
provider failure.
If the available evidence does not answer a question, the API returns
`insufficient_evidence` without citations.

Suggested-question chips are deterministic navigation prompts per screening
topic, not cached medical answers. Selecting one sends exactly one normal
grounded chat request. This keeps the first interaction responsive without
manufacturing a clinical answer before the user asks it.

The active citation contract is sentence-level and server-owned. Candidate quote
spans are literal NEI sentences or adjacent sentence pairs. The highest scoring
span per article receives a marker immediately after its answer sentence only
when it clears a conservative score and separation margin; the renderer then
shows that stored verbatim span. A low-confidence sentence can retain broader
article provenance in the expanded list but never gets a fake exact quote. The
renderer never receives an opaque source ID as chat text.

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
4. Verify `/v1/health` reports `rag.ready: true`, `citation_mode: "sentence"`,
   and `evidence_reference_mode: "server_attribution"`,
   then test one grounded answer, one unsupported answer, suggested questions,
   citation expansion, refresh persistence, and a legacy chat row.

Without `NAYANA_RAG_VERSION`, the existing non-RAG chat remains active. This
provides a deliberate rollback path without deleting a corpus or migration.
