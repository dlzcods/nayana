import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { BrandMark } from '../components/BrandMark'
import { ProductDemo } from '../components/ProductDemo'
import { SiteHeader } from '../components/SiteHeader'

const screeningUrl = '/screening'
const conditions = [
  { number: '01', name: 'Katarak', copy: 'Mengenali pola yang mirip dengan kekeruhan pada lensa mata.' },
  { number: '02', name: 'Glaukoma', copy: 'Mengenali perubahan pola di sekitar saraf mata. Pemeriksaan tekanan mata tetap perlu dilakukan langsung oleh dokter spesialis mata (Sp.M).' },
  { number: '03', name: 'Retinopati diabetik', copy: 'Mengenali pola perubahan retina yang dapat berkaitan dengan diabetes.' },
  { number: '04', name: 'Kategori normal', copy: 'Foto paling mirip dengan kategori normal. Namun, sistem tidak memeriksa semua kondisi mata, sehingga pemeriksaan berkala tetap disarankan.' },
]
const privacyPrinciples = [
  { number: '01', title: 'Unggah tanpa identitas', copy: 'Gunakan foto retina tanpa nama atau nomor rekam medis.' },
  { number: '02', title: 'Analisis yang terarah', copy: 'Sistem membaca pola visual yang dibutuhkan untuk hasil awal.' },
  { number: '03', title: 'Keputusan tetap pada Anda', copy: 'Bawa hasilnya kepada dokter spesialis mata (Sp.M.).' },
]
const faqs = [
  { question: 'Apakah hasil ini merupakan diagnosis medis?', answer: 'Tidak. Hasil ini adalah gambaran awal, bukan diagnosis medis.' },
  { question: 'Foto seperti apa yang sebaiknya diunggah?', answer: 'Gunakan foto retina yang terang, fokus, dan menampilkan area retina dengan jelas tanpa nama atau nomor rekam medis.' },
  { question: 'Apa arti persentase pada hasil?', answer: 'Persentase menunjukkan tingkat kemiripan pola dengan kategori yang dipelajari sistem, bukan tingkat keparahan kondisi.' },
  { question: 'Kapan saya perlu menemui dokter spesialis mata?', answer: 'Bawa hasil awal ini kepada dokter spesialis mata (Sp.M.) jika Anda memiliki keluhan penglihatan atau membutuhkan pemeriksaan lebih menyeluruh.' },
]

export function LandingPage() {
  const reduceMotion = useReducedMotion()
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const reveal = reduceMotion ? {} : { initial: { opacity: 0, y: 24 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, amount: 0.2 }, transition: { duration: 0.65 } }

  return (
    <div className="optic-page" id="beranda">
      <SiteHeader />

      <main>
        <section className="optic-hero optic-shell">
          <motion.div className="optic-hero__copy" initial={reduceMotion ? undefined : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.65 }}>
            <p className="optic-overline">Alat bantu cek awal kesehatan mata</p>
            <h1>Kenali Kondisi Mata <span className="optic-hero__underline">Lebih Awal.</span></h1>
            <p className="optic-hero__lead">Unggah foto retina untuk mendapatkan gambaran awal sebelum berkonsultasi dengan dokter spesialis mata (Sp.M).</p>
            <div className="optic-actions"><a className="optic-primary" href={screeningUrl}>Cek sekarang</a><a className="optic-secondary" href="#cara-kerja">Pelajari cara kerja <span aria-hidden="true">↗</span></a></div>
            {/*<p className="optic-medical-note">Hasil ini adalah panduan awal, bukan diagnosis resmi. Selalu konfirmasikan kondisi mata Anda ke dokter spesialis mata (Sp.M).</p>*/}
          </motion.div>
          <motion.figure className="optic-hero__image" initial={reduceMotion ? undefined : { opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: reduceMotion ? 0 : 0.75, delay: reduceMotion ? 0 : 0.12 }}>
            <img src="/assets/eye-original/slit-lamp-examination-wide.jpg" alt="Dokter memeriksa mata pasien menggunakan slit lamp" />
          </motion.figure>
        </section>

        <section className="optic-context optic-shell" aria-labelledby="context-title">
          <div className="optic-context__images" aria-hidden="true"><img src="/assets/eye-original/eye-through-optical-lens-portrait.jpg" alt="" /><img src="/assets/eye-original/ophthalmic-lens-tools-flatlay.jpg" alt="" /></div>
          <motion.div className="optic-context__copy" {...reveal}><p className="optic-index">01 &nbsp; Mengapa penting cek lebih awal</p><h2 id="context-title">Masalah pada mata sering kali tak terasa di awal.</h2><p>Deteksi dini membuat Anda bisa bertindak lebih cepat. NAYANA membantu membaca pola pada foto retina Anda sebagai panduan awal, sehingga Anda tahu pertanyaan apa yang perlu diajukan saat bertemu dokter spesialis mata (Sp.M).</p></motion.div>
        </section>

        <section className="optic-process" id="cara-kerja" aria-labelledby="process-title"><div className="optic-shell">
          <div className="optic-section-head"><p className="optic-index">02 &nbsp; Cara kerja</p><h2 id="process-title">Satu foto, petunjuk awal. Keputusan tetap di tangan ahli.</h2><p>Prosesnya dibuat ringkas dan transparan untuk membantu Anda memahami kondisi mata tanpa menggantikan peran dokter.</p></div>
          <div className="optic-process__body">
            <figure className="optic-process__image"><img src="/assets/eye-original/diagnostic-eye-scan-wide.jpg" alt="Proses pengambilan citra mata menggunakan alat diagnostik" /><figcaption>Foto retina yang jernih membantu sistem membaca pola dengan lebih akurat.</figcaption></figure>
            <ol className="optic-steps">
              <li><span>01</span><div><h3>Unggah foto retina</h3><p>Gunakan foto retina (fundus) yang terang, fokus, dan menampilkan area retina dengan jelas.</p></div></li>
              <li><span>02</span><div><h3>Analisis pola visual</h3><p>Sistem membaca pola pada foto Anda dan mencocokkannya dengan indikasi umum masalah mata.</p></div></li>
              <li><span>03</span><div><h3>Pahami gambaran awal</h3><p>Lihat indikasi yang paling mendekati beserta tingkat kemiripan polanya.</p></div></li>
              <li><span>04</span><div><h3>Konsultasi ke dokter</h3><p>Bawa hasil awal ini kepada dokter spesialis mata (Sp.M) untuk pemeriksaan menyeluruh.</p></div></li>
            </ol>
          </div>
        </div></section>

        <section className="optic-demo optic-shell" aria-labelledby="demo-title">
          <div className="optic-section-head optic-section-head--split"><div><p className="optic-index">03 &nbsp; Hasil yang Anda dapatkan</p><h2 id="demo-title">Lihat gambaran awal kondisi mata Anda.</h2></div><p>Sistem membandingkan pola pada foto retina Anda dengan pola yang telah dipelajari. Persentase menunjukkan seberapa mirip polanya, bukan seberapa parah kondisinya.</p></div>
          <ProductDemo />
        </section>

        <section className="optic-conditions optic-shell" id="cakupan" aria-labelledby="conditions-title">
          <div className="optic-conditions__intro"><p className="optic-index">04 &nbsp; Kondisi yang dapat dikenali</p><h2 id="conditions-title">Saat ini, sistem mengenali empat kategori pada foto retina.</h2><img src="/assets/eye-original/anatomical-eye-model-wide.jpg" alt="Model anatomi mata yang menunjukkan bagian-bagian mata" /></div>
          <div className="optic-condition-list">{conditions.map((item) => <article className="optic-condition" key={item.name}><span>{item.number}</span><h3>{item.name}</h3><p>{item.copy}</p></article>)}</div>
        </section>

        <section className="optic-human" aria-labelledby="human-title"><div className="optic-shell optic-human__grid">
          <div className="optic-human__gallery"><img src="/assets/eye-original/trial-frame-fitting-portrait.jpg" alt="Tenaga kesehatan memasangkan trial frame kepada pasien" /><img src="/assets/eye-original/trial-frame-examination-wide.jpg" alt="Pasien menjalani evaluasi lensa dengan trial frame" /></div>
          <motion.div className="optic-human__copy" {...reveal}><p className="optic-index">05 &nbsp; Sistem membantu, dokter memastikan</p><h2 id="human-title">Sistem membaca foto. Dokter memahami kondisi Anda secara menyeluruh.</h2><p>Sistem hanya membaca pola visual pada foto retina. Dokter spesialis mata (Sp.M) melengkapinya dengan gejala yang Anda rasakan, riwayat kesehatan, tekanan mata, dan pemeriksaan langsung.</p><a className="optic-secondary" href="/model-evidence">Lihat cara membaca hasil <span aria-hidden="true">↗</span></a></motion.div>
        </div></section>

        <section className="optic-privacy" id="privasi" aria-labelledby="privacy-title"><div className="optic-shell">
          <motion.div className="optic-privacy__head" {...reveal}>
            <p className="optic-index">06 &nbsp; Privasi &amp; keamanan</p>
            <h2 id="privacy-title">Foto Anda.<br />Informasi seperlunya.</h2>
          </motion.div>
          <div className="optic-privacy__body">
            <motion.article className="optic-privacy__principle optic-privacy__principle--one" {...reveal}>
              <span>{privacyPrinciples[0].number}</span><h3>{privacyPrinciples[0].title}</h3><p>{privacyPrinciples[0].copy}</p>
            </motion.article>
            <motion.article className="optic-privacy__principle optic-privacy__principle--two" {...reveal}>
              <span>{privacyPrinciples[1].number}</span><h3>{privacyPrinciples[1].title}</h3><p>{privacyPrinciples[1].copy}</p>
            </motion.article>
            <motion.article className="optic-privacy__principle optic-privacy__principle--three" {...reveal}>
              <span>{privacyPrinciples[2].number}</span><h3>{privacyPrinciples[2].title}</h3><p>{privacyPrinciples[2].copy}</p>
            </motion.article>
          </div>
        </div></section>

        <section className="optic-faq optic-shell" id="faq" aria-labelledby="faq-title">
          <div className="optic-faq__head"><p className="optic-index">07 &nbsp; Pertanyaan umum</p><h2 id="faq-title">Jawaban singkat sebelum Anda memulai.</h2></div>
          <div className="optic-faq__list">
            {faqs.map((faq, index) => {
              const isOpen = openFaq === index
              const panelId = `faq-panel-${index}`
              return (
                <article className="optic-faq__item" key={faq.question}>
                  <button type="button" aria-expanded={isOpen} aria-controls={panelId} onClick={() => setOpenFaq(isOpen ? null : index)}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{faq.question}</strong>
                    <i aria-hidden="true">{isOpen ? '−' : '+'}</i>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div id={panelId} className="optic-faq__answer" initial={reduceMotion ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={reduceMotion ? undefined : { height: 0, opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}>
                        <p>{faq.answer}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </article>
              )
            })}
          </div>
        </section>

        <section className="optic-closing optic-shell"><img src="/assets/eye-original/eye-closeup-shadow-portrait.jpg" alt="Close-up mata manusia dalam cahaya dan bayangan" /><div className="optic-closing__overlay"><p>Langkah awal untuk mengenali mata Anda</p><h2>Mulai dari gambaran awal. Lanjutkan dengan pemeriksaan yang tepat.</h2><a className="optic-primary optic-primary--light" href={screeningUrl}>Cek kondisi mata</a></div></section>
      </main>

      <footer className="optic-footer"><div className="optic-shell optic-footer__top">
        <div><BrandMark /><p>Prototipe riset untuk panduan awal foto retina. Bukan perangkat medis dan bukan layanan darurat.</p></div>
        <nav aria-label="Tautan proyek"><span>Proyek</span><a href="#cara-kerja">Cara kerja</a><a href="/model-evidence">Bukti model</a><a href={screeningUrl}>Demo analisis</a></nav>
        <nav aria-label="Tautan kepercayaan"><span>Kepercayaan</span><a href="/terms">Ketentuan penggunaan</a></nav>
      </div><div className="optic-shell optic-footer__bottom"><span>© 2026 NAYANA</span><span>Pemeriksaan klinis tetap dilakukan oleh dokter spesialis mata (Sp.M).</span></div></footer>
    </div>
  )
}
