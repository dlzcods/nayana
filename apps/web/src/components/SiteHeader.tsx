import { useEffect, useState } from 'react'
import { BrandMark } from './BrandMark'

const screeningUrl = 'https://huggingface.co/spaces/dielz/eye-disease-classification'
const navItems = [
  { label: 'Beranda', href: '/' },
  { label: 'Cara kerja', href: '/#cara-kerja' },
  { label: 'Cakupan', href: '/#cakupan' },
  { label: 'Bukti model', href: '/model-evidence' },
]

export function SiteHeader() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  return (
    <header className="optic-header">
      <div className="optic-shell optic-header__inner">
        <nav className="optic-header__left" aria-label="Navigasi utama">
          {navItems.slice(0, 3).map((item) => (
            <a href={item.href} key={item.label}>{item.label}</a>
          ))}
        </nav>
        <BrandMark />
        <nav className="optic-header__right" aria-label="Navigasi pendukung">
          <a href="/model-evidence">Bukti model</a>
          <a className="optic-header__screen" href={screeningUrl} target="_blank" rel="noreferrer">Cek kondisi mata</a>
        </nav>
        <button
          className="optic-menu"
          type="button"
          aria-expanded={open}
          aria-controls="optic-mobile-nav"
          onClick={() => setOpen((value) => !value)}
        >
          <span>{open ? 'Tutup' : 'Menu'}</span><i aria-hidden="true" />
        </button>
      </div>
      {open && (
        <nav id="optic-mobile-nav" className="optic-mobile-nav optic-shell" aria-label="Navigasi seluler">
          {navItems.map((item) => <a href={item.href} key={item.label} onClick={() => setOpen(false)}>{item.label}</a>)}
          <a className="optic-primary" href={screeningUrl} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>Cek kondisi mata</a>
        </nav>
      )}
    </header>
  )
}
