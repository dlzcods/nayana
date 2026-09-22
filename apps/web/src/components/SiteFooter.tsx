import { BrandMark } from './BrandMark'

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell site-footer__grid">
        <div>
          <BrandMark />
          <p>NAYANA adalah prototipe riset untuk membantu memahami hasil skrining awal dari foto retina. Bukan perangkat medis dan bukan layanan darurat.</p>
        </div>
        <div className="footer-links">
          <span>Tentang NAYANA</span>
          <a href="/#cara-kerja">Cara kerja</a>
          <a href="/model-evidence">Hasil uji</a>
          <a href="/screening">Mulai skrining</a>
        </div>
        <div className="footer-links">
          <span>Privasi &amp; ketentuan</span>
          <a href="/trust">Privasi & data</a>
          <a href="/terms">Ketentuan penggunaan</a>
        </div>
      </div>
      <div className="shell site-footer__bottom">
        <span>© 2026 NAYANA</span>
        <span>Pemeriksaan klinis tetap dilakukan oleh dokter spesialis mata (Sp.M).</span>
      </div>
    </footer>
  )
}
