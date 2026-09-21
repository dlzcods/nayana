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
    .pip_install("torch==2.8.0+cpu", index_url="https://download.pytorch.org/whl/cpu")
    .pip_install_from_requirements(LOCAL_DIR / "requirements.api.txt")
    .pip_install_from_requirements(LOCAL_DIR / "requirements.rag.txt")
    .env({"NAYANA_RAG_ARTIFACTS": "/rag-data",
          "TOKENIZERS_PARALLELISM": "false", "USE_TF": "0"})
    .add_local_dir(LOCAL_DIR / "rag", f"{REMOTE_DIR}/rag")
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
rag_volume = modal.Volume.from_name("nayana-nei-rag", create_if_missing=False)


# `timeout` is execution time, not the keep-warm interval.  The earlier 120-second
# value could terminate a valid cold RAG request while it was loading the encoder
# and waiting for the LLM.  Keep the normal five-minute execution ceiling, while
# retaining a completed container for fifteen minutes to improve the next interaction.
@app.function(
    image=image,
    secrets=[llm_secret],
    volumes={"/rag-data": rag_volume},
    timeout=300,
    scaledown_window=900,
    min_containers=0,
    memory=4096,
)
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
