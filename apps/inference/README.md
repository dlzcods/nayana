# NAYANA inference service

Layanan skrining awal NAYANA. `app.py` mempertahankan prototipe Gradio dari
Space sumber. `nayana_api.py` adalah API FastAPI untuk aplikasi web NAYANA.
`modal_app.py` adalah entrypoint deploy Modal untuk API ini.
`modal_report_app.py` adalah layanan PDF ringan yang terpisah dari runtime
TensorFlow, sehingga pembuatan laporan tidak perlu menunggu cold start inference.

## Preview frontend tanpa inference lokal

Tahap 1 membuka enam contoh fundus yang dibundel proyek. Tahap 2 menerima foto
pribadi untuk skrining awal: file dinormalisasi di memori untuk membuang metadata,
lalu langsung dianalisis oleh SavedModel yang sama dengan mode contoh. Foto tidak
dikirim ke layanan pihak ketiga atau disimpan pada tahap ini. Endpoint ringkasan
otomatis hanya menerima skor hasil, tidak menerima foto fundus, dan memakai
`GEMINI_API_KEY` di environment Modal.

Gunakan `npm run dev:web` dari root monorepo untuk mengecek layout dan state
kosong UI. Tidak perlu menginstal TensorFlow di komputer lokal. Setelah API
Modal tersedia, arahkan frontend ke URL tersebut melalui
`VITE_NAYANA_API_BASE_URL` sebelum menjalankan Vite.

## Deploy API ke Modal

Modal membangun image remote dari `requirements.api.txt`, lalu menerima source
API, aset demo, dan SavedModel yang dibutuhkan. Jalankan sendiri dari folder
ini setelah `modal setup` selesai:

```bash
cd apps/inference
modal deploy modal_app.py
```

Salin URL yang dicetak Modal ke `apps/web/.env.local`:

```bash
VITE_NAYANA_API_BASE_URL="https://URL-API-ANDA.modal.run"
```

Lalu jalankan ulang `npm run dev:web` dari root project. CORS default API
sudah mengizinkan `http://localhost:5173`, `http://localhost:5174`,
`https://nayana.dielz032.workers.dev`.
`NAYANA_WEB_ORIGINS` tetap dapat digunakan untuk mengganti daftar tersebut
secara eksplisit pada runtime yang memasang environment variable itu.

## Deploy layanan PDF ringan

Laporan PDF sekarang dijalankan oleh aplikasi Modal tersendiri. Aplikasi ini
memasang hanya FastAPI, Pillow, dan ReportLab; tidak memuat SavedModel,
TensorFlow, Gemini, atau secret. Jalankan sendiri setelah API utama tersedia:

    cd apps/inference
    modal deploy modal_report_app.py

Tambahkan URL yang dicetak Modal ke `apps/web/.env.local`, lalu restart Vite:

    VITE_NAYANA_REPORT_API_BASE_URL="https://URL-REPORT-ANDA.modal.run"

Lampiran foto saat pengguna memilihnya dikirim sebagai multipart JPEG mentah,
bukan base64 dalam JSON. Foto tetap digunakan hanya selama pembuatan PDF yang
diunduh pengguna.

Container laporan dipertahankan selama dua menit setelah request terakhir
(`scaledown_window=120`) untuk mengurangi cold start pada sesi yang berdekatan.
Ia tetap dapat scale ke nol setelah periode idle tersebut; `min_containers`
tidak diaktifkan karena akan menambah biaya idle secara terus-menerus.

## Ringkasan otomatis

Endpoint `GET /v1/health` menampilkan apakah `GEMINI_API_KEY` terdeteksi dan
nama model yang dipakai, tanpa pernah menampilkan nilai key. Bila pembuatan
ringkasan gagal, API mencatat traceback provider di Modal Logs dan UI hanya
menerima nama tipe error yang aman sebagai kode pemeriksaan.

Tambahkan `GEMINI_API_KEY` dan `GEMINI_MODEL` pada secret Modal bernama `nayana`.
Default model di `.env.example` mengikuti konfigurasi Gemma yang disepakati. API
menggunakan temperature `0.3`, meminta JSON terstruktur, dan menonaktifkan output
thought. Apabila secret, model, atau layanan tidak tersedia, endpoint ringkasan
mengembalikan status tidak tersedia tanpa mengubah hasil skrining.

## Chat dengan rujukan NEI

Chat dapat memakai RAG dari lima artikel NEI yang diizinkan secara eksplisit.
Pipeline scraping Firecrawl, chunking token-safe, embedding E5, FAISS, kontrak
sitasi, evaluasi, dan urutan aktivasi produksi dijelaskan di
`../../docs/provenance/nei-rag.md`. API tetap memakai alur chat lama sampai
`NAYANA_RAG_VERSION` diisi dengan versi kandidat yang telah diuji. Jangan pernah
menaruh `FIRECRAWL_API_KEY` pada secret frontend atau file yang masuk Git.

### Perilaku provider chat

Jawaban RAG tetap merupakan satu request dinamis: server mengambil maksimal empat
evidence NEI yang relevan, lalu meminta Gemma hanya menulis jawaban Bahasa
Indonesia dalam satu field `answer`. Gemma tidak menerima atau menghasilkan ID,
alias, marker, URL, maupun kutipan sumber. Retrieval menggabungkan E5 semantic
search dan BM25 keyword search dengan reciprocal-rank fusion; pertanyaan yang
menyebut satu kondisi secara eksplisit tidak boleh membawa source kondisi lain.
Setelah itu server membandingkan tiap kalimat jawaban dengan kandidat kalimat
verbatim dari evidence memakai encoder E5 yang sama. Hanya kecocokan berambang
konservatif yang mendapat marker tepat setelah kalimat dan quote card; jika
keyakinannya rendah, kalimat tetap tampil tanpa klaim quote spesifik.

Instruksi dan schema membatasi jawaban hingga tiga paragraf edukatif dan satu
batas keselamatan, dengan total 1.800 karakter. Evidence diparafrasekan, bukan
disalin atau diterjemahkan harfiah dari artikel NEI.

Pertanyaan starter adalah navigasi deterministik per topik, bukan jawaban medis
yang dicache. Memilihnya tetap mengirim satu request RAG biasa.

Tidak ada retry otomatis atau jawaban fallback yang berpura-pura bersumber.
Jika provider berhenti sebelum JSON lengkap, request gagal secara jujur. Modal
Logs mencatat model, durasi, finish reason, dan panjang respons saja; pertanyaan
pengguna, evidence NEI, serta respons parsial tidak dicatat.

Batas request provider selaras dengan timeout Modal, yaitu 300 detik. Nilai ini
berada di konstanta kode `RAG_PROVIDER_TIMEOUT_MS`, bukan secret atau variable
Modal. Nilai tersebut mencegah client memotong generation aktif di detik ke-120;
ia bukan jaminan bahwa provider akan selalu menyelesaikan respons lebih cepat.

## Prototipe Gradio sumber

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
- `../../docs/provenance/nei-rag.md`: sumber, pipeline, evaluasi, dan rollout RAG.
- `../../third_party/eye-disease-classification/LICENSE.txt`: lisensi sumber.

## Batas penggunaan

Output merupakan klasifikasi eksperimental, bukan diagnosis medis. Foto fundus saja tidak mencakup gejala, riwayat kesehatan, tekanan mata, maupun pemeriksaan klinis. Hasil perlu divalidasi oleh dokter spesialis mata (Sp.M).
