import { useEffect, useState } from 'react'
import { BrandMark } from './BrandMark'
import { authChangeEvent, getAuthSession } from '../lib/supabase-auth'

const navItems = [
  { label: 'Beranda', href: '/' },
  { label: 'Cara kerja', href: '/#cara-kerja' },
  { label: 'Cakupan', href: '/#cakupan' },
  { label: 'Hasil uji', href: '/model-evidence' },
]

export function SiteHeader() {
  const [open, setOpen] = useState(false)
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    const syncSignedIn = () => setSignedIn(Boolean(getAuthSession()))
    syncSignedIn()
    window.addEventListener(authChangeEvent, syncSignedIn)
    window.addEventListener('storage', syncSignedIn)
    return () => {
      window.removeEventListener(authChangeEvent, syncSignedIn)
      window.removeEventListener('storage', syncSignedIn)
    }
  }, [])

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
          <a href="/model-evidence">Hasil uji</a>
          <a href={signedIn ? '/history' : '/login'}>{signedIn ? 'Riwayat' : 'Masuk'}</a>
          <a className="optic-header__screen" href="/screening">Mulai skrining</a>
        </nav>
        <button
          className="optic-menu"
          type="button"
          aria-label={open ? 'Tutup menu' : 'Buka menu'}
          aria-expanded={open}
          aria-controls="optic-mobile-nav"
          onClick={() => setOpen((value) => !value)}
        >
          <i aria-hidden="true" />
        </button>
      </div>
      {open && (
        <nav id="optic-mobile-nav" className="optic-mobile-nav optic-shell" aria-label="Navigasi seluler">
          {navItems.map((item) => <a href={item.href} key={item.label} onClick={() => setOpen(false)}>{item.label}</a>)}
          <a href={signedIn ? '/history' : '/login'} onClick={() => setOpen(false)}>{signedIn ? 'Riwayat' : 'Masuk'}</a>
          <a className="optic-primary" href="/screening" onClick={() => setOpen(false)}>Mulai skrining</a>
        </nav>
      )}
    </header>
  )
}
