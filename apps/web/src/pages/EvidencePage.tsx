import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'

export function EvidencePage() {
  return (
    <div className="page">
      <SiteHeader />
      <main className="document shell">
        <a className="document__back" href="/">← Kembali ke halaman utama</a>
        <p className="eyebrow">Tentang pengujian sistem</p>
        <h1>Seberapa baik sistem ini bekerja?</h1>
        <p className="document__lead">
          Di halaman ini, Anda dapat melihat jumlah foto yang digunakan, hasil pengujian, dan hal-hal yang dapat memengaruhi hasilnya.
        </p>
        <section>
          <h2>Hasil pengujian saat ini</h2>
          <dl className="evidence-table">
            <div><dt>Data pelatihan</dt><dd>Sekitar 4.000 foto retina</dd></div>
            <div><dt>Data pengujian terpisah</dt><dd>844 foto retina</dd></div>
            <div><dt>Akurasi uji coba</dt><dd>90,64%</dd></div>
            <div><dt>Kategori analisis</dt><dd>Katarak, retinopati diabetik, glaukoma, dan normal</dd></div>
          </dl>
        </section>
        <section>
          <h2>Hal yang dapat memengaruhi hasil</h2>
          <p>
            Akurasi sistem bisa bervariasi tergantung pada kualitas kamera, pencahayaan, dan kejernihan foto. Sistem juga tidak menilai gejala fisik, riwayat medis, atau tekanan bola mata.
          </p>
          <p>
            Tingkat kecocokan menunjukkan seberapa mirip pola foto Anda dengan data acuan kami, bukan peluang pasti seseorang menderita penyakit tersebut.
          </p>
        </section>
        <section>
          <h2>Cara menggunakan hasil dengan aman</h2>
          <p>
            Platform ini dibuat sebagai sarana edukasi dan alat bantu cek awal. Jika Anda merasakan gejala yang mengganggu atau memiliki keraguan, segera konsultasikan dengan dokter spesialis mata (Sp.M).
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
