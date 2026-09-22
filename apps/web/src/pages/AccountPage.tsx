import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import {
  getAuthSession,
  signOut,
  type AuthSession,
} from '../lib/supabase-auth'

function firstName(name: string | null) {
  return name?.trim().split(/\s+/)[0] || 'Anda'
}

export function AccountPage() {
  const [session] = useState<AuthSession | null>(getAuthSession())
  useEffect(() => {
    const existingSession = getAuthSession()
    if (!existingSession) {
      window.location.replace('/login')
    }
  }, [])

  if (!session) return null

  return (
    <div className="app-page">
      <SiteHeader />
      <main className="app-shell app-account">
        <section className="app-account__intro" aria-labelledby="account-title">
          <p className="app-kicker">Akun NAYANA</p>
          <h1 id="account-title">Halo, {firstName(session.displayName)}.</h1>
          <p>Simpan hasil skrining dan buka kembali dari perangkat lain selama masa simpan yang Anda pilih.</p>
        </section>

        <section className="app-account__actions" aria-label="Pilihan akun">
          <Link className="app-primary-action" to="/screening">Mulai skrining</Link>
          <div>
            <p className="app-account__email">{session.email || 'Akun Google terhubung'}</p>
            <button className="app-text-action" type="button" onClick={() => { void signOut(); window.location.replace('/') }}>
              Keluar dari akun
            </button>
          </div>
        </section>
        <section className="app-history" aria-labelledby="history-title">
          <div className="app-history__head">
            <div>
              <p className="app-kicker">Riwayat skrining</p>
              <h2 id="history-title">Buka hasil yang tersimpan.</h2>
            </div>
            <span>Detail hasil, foto privat, dan percakapan tersedia dalam satu ruang.</span>
          </div>
          <Link className="app-primary-action" to="/history" search={{ hasil: undefined }}>Buka riwayat skrining</Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
