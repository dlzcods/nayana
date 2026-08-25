# NAYANA inference service

Layanan Gradio untuk menjalankan model klasifikasi foto fundus dan menampilkan edukasi lanjutan melalui Gemini.

## Setup

Dari root monorepo, unduh model jika folder `model/` belum tersedia:

```bash
./scripts/download-model.sh
```

Lalu jalankan service:

```bash
cd apps/inference
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

`app.py` membaca `GEMINI_API_KEY` dan `GEMINI_MODEL` dari environment. File `.env` tidak dibaca otomatis; ekspor variabel tersebut melalui shell atau gunakan pengelola environment pilihanmu.

## Isi direktori

- `app.py`: antarmuka Gradio dan alur inference.
- `model/`: SavedModel TensorFlow lokal; diabaikan oleh Git.
- `model.sha256`: checksum artefak model yang digunakan proyek.
- `assets/examples/`: contoh foto yang tampil di Gradio.
- `../../research/notebooks/`: notebook pelatihan dari Space sumber.
- `../../docs/provenance/hugging-face-space.md`: README asli dari Space.
- `../../third_party/eye-disease-classification/LICENSE.txt`: lisensi sumber.

## Batas penggunaan

Output merupakan klasifikasi eksperimental, bukan diagnosis medis. Foto fundus saja tidak mencakup gejala, riwayat kesehatan, tekanan mata, maupun pemeriksaan klinis. Hasil perlu divalidasi oleh dokter spesialis mata (Sp.M).
