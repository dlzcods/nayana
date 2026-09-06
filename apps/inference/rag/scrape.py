"""Explicit five-URL Firecrawl ingestion; no recursive crawling or user data.

python -m rag.scrape --dry-run
FIRECRAWL_API_KEY=... python -m rag.scrape [--refresh]
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
import ssl
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .common import ARTIFACTS, ATTRIBUTION, digest, sources, write_json


def fetch(source: dict, api_key: str) -> dict:
    import certifi
    tls = ssl.create_default_context(cafile=certifi.where())
    body = json.dumps({
        "url": source["url"], "formats": ["markdown"],
        "onlyMainContent": True, "timeout": 60000,
        "excludeTags": ["nav", "footer", "header", "script", "style"],
    }).encode()
    for attempt in range(3):
        request = Request("https://api.firecrawl.dev/v2/scrape", data=body, headers={
            "Authorization": f"Bearer {api_key}", "Content-Type": "application/json",
        })
        try:
            with urlopen(request, timeout=90, context=tls) as response:
                result = json.load(response)
            if not result.get("success"):
                raise ValueError("Firecrawl did not return a successful scrape")
            data = result.get("data", {})
            markdown = data.get("markdown", "")
            metadata = data.get("metadata", {})
            if metadata.get("statusCode", 200) != 200 or len(markdown.strip()) < 250:
                raise ValueError("Empty, blocked or incomplete source page")
            for field in ("sourceURL", "url"):
                if metadata.get(field) and metadata[field].rstrip("/") != source["url"].rstrip("/"):
                    raise ValueError("Source URL changed; manual allowlist review required")
            return {**source, "markdown": markdown, "metadata": metadata,
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                    "raw_sha256": digest(markdown), "attribution": ATTRIBUTION}
        except HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                # Do not print response bodies, request headers or the credential.
                raise RuntimeError(f"Firecrawl HTTP {error.code}") from None
            retry = error.headers.get("Retry-After", "")
            time.sleep(min(float(retry) if retry.isdigit() else 2 ** (attempt + 1), 30))
        except (URLError, TimeoutError) as error:
            if isinstance(getattr(error, "reason", None), ssl.SSLCertVerificationError):
                raise RuntimeError("TLS certificate verification failed; update the CA bundle") from None
            if attempt == 2:
                raise RuntimeError("Firecrawl connection unavailable") from None
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError("Scrape retries exhausted")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    if args.dry_run:
        print(json.dumps({"count": len(sources()), "recursive": False, "sources": sources()}, indent=2))
        return
    key = os.getenv("FIRECRAWL_API_KEY", "").strip()
    if not key:
        raise SystemExit("Set FIRECRAWL_API_KEY in the process environment (never commit it).")
    failed = []
    for source in sources():
        path = ARTIFACTS / "raw" / f"{source['id']}.json"
        if path.exists() and not args.refresh:
            cached = json.loads(path.read_text())
            if cached.get("url") == source["url"] and digest(cached.get("markdown", "")) == cached.get("raw_sha256"):
                print(f"Reusing {source['id']}")
                continue
        try:
            write_json(path, fetch(source, key))
            print(f"Saved {source['id']}")
        except (ValueError, RuntimeError) as error:
            failed.append(source["id"])
            print(f"Failed {source['id']}: {error}")
    if failed:
        raise SystemExit("Incomplete corpus; rerun to resume. Failed: " + ", ".join(failed))
    print("All five source snapshots available. Review before indexing.")


if __name__ == "__main__":
    main()
