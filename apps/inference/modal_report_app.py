"""Modal entrypoint for the lightweight NAYANA PDF report API."""

from pathlib import Path

import modal


LOCAL_DIR = Path(__file__).resolve().parent
REMOTE_DIR = "/root/nayana-report"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install_from_requirements(LOCAL_DIR / "requirements.report.txt")
    .add_local_file(LOCAL_DIR / "report_api.py", REMOTE_DIR + "/report_api.py")
    .add_local_file(
        LOCAL_DIR.parent / "web" / "public" / "brand" / "nayana-2.png",
        REMOTE_DIR + "/assets/nayana-logo.png",
    )
)

app = modal.App("nayana-report")


@app.function(image=image, timeout=30, scaledown_window=120)
@modal.asgi_app()
def report_api():
    import sys

    if REMOTE_DIR not in sys.path:
        sys.path.insert(0, REMOTE_DIR)

    from report_api import app as fastapi_app

    return fastapi_app
