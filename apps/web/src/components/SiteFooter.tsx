import { BrandMark } from './BrandMark'

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell site-footer__grid">
        <div>
          <BrandMark />
          <p>Prototipe riset untuk panduan awal foto retina. Bukan perangkat medis dan bukan layanan darurat.</p>
        </div>
        <div className="footer-links">
          <span>Proyek</span>
          <a href="/#cara-kerja">Cara kerja</a>
          <a href="/model-evidence">Bukti model</a>
          <a href="/screening">Demo analisis</a>
        </div>
        <div className="footer-links">
          <span>Kepercayaan</span>
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
