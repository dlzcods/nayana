import { BrandMark } from '../components/BrandMark'

type LegalPageProps = {
  kind: 'privacy' | 'terms' | 'not-found'
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
      <header className="legal-page__header shell"><BrandMark /></header>
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
