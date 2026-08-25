# NAYANA

Monorepo untuk landing page NAYANA dan prototipe klasifikasi awal foto fundus.

## Struktur

```text
.
├── apps/
│   ├── web/                 # React, Vite, dan UI publik
│   └── inference/           # Gradio, TensorFlow, dan integrasi Gemini
├── docs/
│   └── provenance/          # Catatan sumber artefak eksternal
├── research/
│   └── notebooks/           # Eksperimen dan notebook pelatihan
├── third_party/
│   └── eye-disease-classification/ # Lisensi artefak sumber
└── scripts/
    └── download-model.sh    # Mengambil model dari Hugging Face
```

## Menjalankan web

```bash
npm install
npm run dev:web
```

Validasi lengkap sebelum commit:

```bash
npm run validate
```

Perintah ini memeriksa struktur monorepo, checksum model lokal jika tersedia, aturan CSS, lint, dan production build.

## Menjalankan layanan inference

Model tidak dimasukkan ke Git karena ukuran file binernya besar. Ambil model yang sama dengan Space sumber:

```bash
./scripts/download-model.sh
```

Kemudian siapkan lingkungan Python dan jalankan aplikasi:

```bash
cd apps/inference
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export GEMINI_API_KEY="your-key"
python app.py
```

Tanpa `GEMINI_API_KEY`, klasifikasi lokal tetap dapat berjalan tetapi penjelasan tambahan dari Gemini tidak tersedia.

## Batas penggunaan

NAYANA adalah prototipe pembelajaran untuk klasifikasi awal empat kelas: katarak, retinopati diabetik, glaukoma, dan normal. Hasilnya bukan diagnosis medis dan perlu dibaca bersama pemeriksaan dokter spesialis mata (Sp.M).

## Sumber model

Model, contoh foto, notebook, serta lisensi berasal dari Hugging Face Space [`dielz/eye-disease-classification`](https://huggingface.co/spaces/dielz/eye-disease-classification). Salinan README sumber disimpan di `docs/provenance/hugging-face-space.md`, sedangkan lisensi sumber disimpan di `third_party/eye-disease-classification/LICENSE.txt`.
