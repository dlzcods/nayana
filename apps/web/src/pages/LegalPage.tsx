import { SiteHeader } from '../components/SiteHeader'

type LegalPageProps = {
  kind: 'privacy' | 'terms' | 'trust' | 'not-found'
}

const legalContent = {
  privacy: {
    eyebrow: 'Pemberitahuan privasi',
    title: 'Foto kesehatan Anda adalah privasi yang kami jaga.',
    intro: 'Dokumen ini menjelaskan kebijakan penanganan data untuk prototipe riset ini sebelum siap digunakan secara luas.',
    sections: [
      ['Pemrosesan foto', 'Foto retina hanya diproses untuk menghasilkan analisis yang Anda minta. Sistem dirancang untuk tidak menyimpan berkas secara permanen tanpa izin Anda.'],
      ['Informasi pribadi', 'Mohon tidak menyertakan nama, nomor rekam medis, atau identitas pribadi lainnya pada foto yang diunggah.'],
      ['Layanan pihak ketiga', 'Pengolahan data dapat terhubung dengan infrastruktur cloud aman. Rincian penyedia layanan tertuang dalam ketentuan privasi final.'],
      ['Kontak dan penghapusan data', 'Anda dapat mengajukan pertanyaan atau permintaan penghapusan data melalui kontak resmi yang tersedia pada halaman ini.'],
    ],
  },
  terms: {
    eyebrow: 'Ketentuan penggunaan',
    title: 'Gunakan hasil sebagai panduan awal, bukan sebagai diagnosis.',
    intro: 'Aturan ini menjelaskan batasan penggunaan alat bantu ini sebagai sarana riset dan edukasi.',
    sections: [
      ['Tujuan penelitian', 'Layanan ini adalah alat bantu pembelajaran berbasis riset. Sistem ini bukan perangkat medis resmi dan tidak menggantikan dokter.'],
      ['Bukan untuk kondisi darurat', 'Jangan gunakan layanan ini saat keadaan darurat. Jika Anda mengalami nyeri mata hebat atau penurunan penglihatan mendadak, segera hubungi fasilitas medis terdekat.'],
      ['Persyaratan foto', 'Sistem ini khusus membaca foto bagian dalam retina (fundus). Foto mata tampak depan biasa tidak akan menghasilkan analisis yang akurat.'],
      ['Konsultasi profesional', 'Setiap hasil analisis sangat disarankan untuk didiskusikan kembali bersama dokter spesialis mata (Sp.M).'],
    ],
  },
  trust: {
    eyebrow: 'Kepercayaan NAYANA',
    title: 'Jelas tentang data, jelas tentang batasnya.',
    intro: 'NAYANA dirancang untuk membantu tahap skrining awal dari foto fundus. Berikut cara kerja data dan batas penggunaan yang dapat Anda lihat langsung di aplikasi.',
    sections: [
      ['Foto digunakan untuk apa?', 'Foto fundus diproses untuk menghasilkan hasil skrining awal yang Anda minta. Bila Anda memilih menyimpan hasil ke akun, foto disimpan privat bersama hasil selama masa simpan yang dipilih.'],
      ['Apakah foto dikirim ke fitur ringkasan atau chat?', 'Tidak. Ringkasan eksekutif dan percakapan menerima label serta skor hasil skrining sebagai konteks, bukan foto fundus Anda.'],
      ['Berapa lama hasil tersimpan?', 'Tanpa akun, ringkasan dapat disimpan di browser selama maksimal 3 hari dan foto tidak disimpan. Pada akun, Anda memilih masa simpan 30 atau 90 hari untuk setiap hasil.'],
      ['Bisakah hasil dihapus?', 'Ya. Hasil, foto privat yang tersimpan, dan percakapan terkait dapat dihapus dari riwayat akun.'],
      ['Apakah ini diagnosis?', 'Tidak. Persentase menunjukkan kemiripan pola pada kategori model, bukan tingkat keparahan atau penetapan kondisi medis. Dokter spesialis mata (Sp.M) melakukan pemeriksaan langsung, validasi klinis, diagnosis, dan penanganan.'],
    ],
  },
  'not-found': {
    eyebrow: '404',
    title: 'Halaman tidak ditemukan.',
    intro: 'Sepertinya Anda tersesat dari alur pemeriksaan. Mari kembali ke halaman utama.',
    sections: [],
  },
}

export function LegalPage({ kind }: LegalPageProps) {
  const content = legalContent[kind]
  return (
    <div className="legal-page">
      <SiteHeader />
      <main className="document shell">
        <a className="document__back" href="/">← Kembali ke halaman utama</a>
        <p className="eyebrow">{content.eyebrow}</p>
        <h1>{content.title}</h1>
        <p className="document__lead">{content.intro}</p>
        {content.sections.map(([title, text]) => (
          <section key={title} id={title === 'Pemrosesan foto' ? 'data-handling' : undefined}>
            <h2>{title}</h2>
            <p>{text}</p>
          </section>
        ))}
        {kind === 'not-found' && <a className="button" href="/">Kembali ke beranda</a>}
      </main>
    </div>
  )
}
