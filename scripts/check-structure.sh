#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
cd "${repo_root}"

required_paths=(
    "apps/web/package.json"
    "apps/web/src"
    "apps/inference/app.py"
    "apps/inference/assets/examples"
    "apps/inference/model.sha256"
    "apps/inference/requirements.txt"
    "docs/provenance/hugging-face-space.md"
    "research/notebooks/eye_diseases_classification_4x.ipynb"
    "third_party/eye-disease-classification/LICENSE.txt"
)

for required_path in "${required_paths[@]}"; do
    if [[ ! -e "${required_path}" ]]; then
        echo "Missing required path: ${required_path}" >&2
        exit 1
    fi
done

forbidden_paths=(
    "services/inference"
    "docs/copywriting"
    "docs/project"
    "apps/inference/exp_eye_images"
    "apps/inference/notebook"
    "apps/web/ASSET_CATALOG.md"
    "apps/web/CSS_RULES.md"
)

for forbidden_path in "${forbidden_paths[@]}"; do
    if [[ -e "${forbidden_path}" ]]; then
        echo "Legacy path returned: ${forbidden_path}" >&2
        exit 1
    fi
done

if ! rg -Fxq "docs/internal/" .gitignore; then
    echo "docs/internal/ must remain ignored." >&2
    exit 1
fi

if ! rg -Fxq "apps/inference/model/" .gitignore; then
    echo "apps/inference/model/ must remain ignored." >&2
    exit 1
fi

stale_pattern="services/inference|exp_eye_images|README_HF|docs/copywriting|docs/project"
if rg -n "${stale_pattern}" . \
    --glob '!apps/web/node_modules/**' \
    --glob '!apps/web/dist/**' \
    --glob '!apps/inference/model/**' \
    --glob '!scripts/check-structure.sh'; then
    echo "Stale path reference detected." >&2
    exit 1
fi

example_count="$(find apps/inference/assets/examples -type f | wc -l | tr -d ' ')"
if [[ "${example_count}" != "6" ]]; then
    echo "Expected 6 inference examples, found ${example_count}." >&2
    exit 1
fi

if [[ -d apps/inference/model ]]; then
    if [[ -n "$(find apps/inference/model -type l -print -quit)" ]]; then
        echo "Inference model must not contain cache symlinks." >&2
        exit 1
    fi

    (
        cd apps/inference
        shasum -a 256 -c model.sha256
    )
else
    echo "Model directory absent; run ./scripts/download-model.sh before inference."
fi

echo "Repository structure guard passed."
