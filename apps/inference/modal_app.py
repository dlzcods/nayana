"""Modal entrypoint for the NAYANA stage-1 screening API.

This module intentionally avoids importing TensorFlow or FastAPI locally.
Modal installs them in its remote image, so local frontend work stays light.
"""

from pathlib import Path

import modal


LOCAL_DIR = Path(__file__).resolve().parent
REMOTE_DIR = "/root/nayana"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install_from_requirements(LOCAL_DIR / "requirements.api.txt")
    .add_local_file(LOCAL_DIR / "nayana_api.py", f"{REMOTE_DIR}/nayana_api.py")
    .add_local_file(
        LOCAL_DIR.parent / "web" / "public" / "brand" / "nayana-2.png",
        f"{REMOTE_DIR}/assets/nayana-logo.png",
    )
    .add_local_dir(LOCAL_DIR / "model", f"{REMOTE_DIR}/model")
    .add_local_dir(LOCAL_DIR / "assets" / "examples", f"{REMOTE_DIR}/assets/examples")
)

app = modal.App("nayana-inference")

llm_secret = modal.Secret.from_name("nayana")


@app.function(image=image, secrets=[llm_secret], timeout=120)
@modal.concurrent(max_inputs=8)
@modal.asgi_app()
def api():
    # Source is mounted into the remote container. TensorFlow lazy-loads only
    # when a demo case is submitted.
    import sys

    if REMOTE_DIR not in sys.path:
        sys.path.insert(0, REMOTE_DIR)

    from nayana_api import app as fastapi_app

    return fastapi_app
