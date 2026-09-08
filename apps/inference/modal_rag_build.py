"""Build/evaluate NEI embeddings remotely. Does not deploy or change production.

From apps/inference: modal run modal_rag_build.py
"""
from pathlib import Path
import modal

LOCAL = Path(__file__).resolve().parent
app = modal.App("nayana-rag-build")
volume = modal.Volume.from_name("nayana-nei-rag", create_if_missing=True)
base_image = (modal.Image.debian_slim(python_version="3.11")
         .pip_install("torch==2.8.0+cpu", index_url="https://download.pytorch.org/whl/cpu")
         .pip_install_from_requirements(LOCAL / "requirements.rag.txt")
         .pip_install("pydantic>=2,<3"))
image = (base_image
         .add_local_dir(LOCAL / "rag", "/root/rag")
         .add_local_dir(LOCAL / "tests" / "rag", "/root/tests/rag")
         .add_local_dir(LOCAL / "artifacts" / "nei-rag" / "raw", "/root/raw"))


@app.function(image=image, volumes={"/rag-data": volume}, timeout=900, cpu=2, memory=4096)
def build_and_evaluate():
    import os
    import shutil
    os.environ["NAYANA_RAG_ARTIFACTS"] = "/rag-data"
    shutil.copytree("/root/raw", "/rag-data/raw", dirs_exist_ok=True)
    from rag.atomic import build_atomic
    from rag.index import build
    from rag.evaluate import evaluate, evaluate_atomic
    manifest = build()
    atomic_manifest = build_atomic(Path("/rag-data/versions") / manifest["version"])
    report = evaluate(Path("/rag-data/versions") / manifest["version"], Path("/root/tests/rag/cases.jsonl"))
    atomic_report = evaluate_atomic(Path("/rag-data/versions") / manifest["version"], Path("/root/tests/rag/cases.jsonl"))
    volume.commit()
    return {"manifest": manifest, "atomic_manifest": atomic_manifest,
            "evaluation": report, "atomic_evaluation": atomic_report}


@app.local_entrypoint()
def main():
    import json
    from rag.common import ARTIFACTS, write_json
    result = build_and_evaluate.remote()
    write_json(ARTIFACTS / "build-result.json", result)
    print(json.dumps({"version": result["manifest"]["version"],
                      "chunks": result["manifest"]["chunk_count"],
                      "atomic_units": result["atomic_manifest"]["unit_count"],
                      "evaluation": result["evaluation"]["summary"],
                      "atomic_evaluation": result["atomic_evaluation"]["summary"]}, indent=2))
