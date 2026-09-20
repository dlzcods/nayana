#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
inference_dir="${repo_root}/apps/inference"

if ! command -v hf >/dev/null 2>&1; then
    echo "Perintah 'hf' belum tersedia. Jalankan: uv tool install hf" >&2
    exit 1
fi

mkdir -p "${inference_dir}"

hf download dielz/eye-disease-classification \
    model/saved_model.pb \
    model/variables/variables.data-00000-of-00001 \
    model/variables/variables.index \
    --repo-type space \
    --local-dir "${inference_dir}"

echo "Model tersedia di ${inference_dir}/model"
