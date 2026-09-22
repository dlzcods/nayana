import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import {
  completeOAuthSession,
  getAuthSession,
  isSupabaseConfigured,
  signInWithGoogle,
  signOut,
  type AuthSession,
} from '../lib/supabase-auth'

export function LoginPage() {
  const [pending, setPending] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [session, setSession] = useState<AuthSession | null>(null)

  useEffect(() => {
    let active = true

    void (async () => {
      try {
        const callbackSession = await completeOAuthSession()
        const existingSession = callbackSession || getAuthSession()
        // The OAuth callback has already provided a signed token. Do not make
        // an additional profile request before allowing the user into the app.
        const nextSession = existingSession
        if (!active) return

        if (nextSession) {
          window.location.replace('/screening?welcome=1')
          return
        }
        setSession(null)
      } catch (reason) {
        if (active) setMessage(reason instanceof Error ? reason.message : 'Koneksi akun belum dapat diperiksa.')
      } finally {
        if (active) setCheckingSession(false)
      }
    })()

    return () => { active = false }
  }, [])

  function beginGoogleLogin() {
    setPending(true)
    setMessage(null)
    try {
      signInWithGoogle()
    } catch (reason) {
      setPending(false)
      setMessage(reason instanceof Error ? reason.message : 'Login Google belum dapat dimulai.')
    }
  }

  return (
    <div className="app-page">
      <SiteHeader />
      <main className="app-shell app-auth">
        <section className="app-auth__intro" aria-labelledby="login-title">
          <p className="app-kicker">Akun NAYANA</p>
          <h1 id="login-title">Simpan hasil saat Anda membutuhkannya.</h1>
          <p>Masuk bersifat opsional. Tanpa akun, Anda tetap dapat menjalankan skrining awal dari foto fundus.</p>
        </section>

        <section className="app-auth__panel" aria-labelledby="auth-panel-title">
          {checkingSession ? (
            <div className="app-login-transition" role="status">
              <p className="app-kicker">Menyiapkan akun</p>
              <h2 id="auth-panel-title">Sebentar, kami menghubungkan akun Anda.</h2>
              <p>Anda akan langsung diarahkan ke skrining.</p>
            </div>
          ) : !isSupabaseConfigured ? (
            <>
              <h2 id="auth-panel-title">Login belum tersedia saat ini.</h2>
              <p>Anda tetap dapat melanjutkan skrining tanpa akun.</p>
            </>
          ) : session ? (
            <>
              <h2 id="auth-panel-title">Anda sudah masuk.</h2>
              <p>{session.email || 'Akun Google Anda siap digunakan.'}</p>
              <button className="app-secondary-action" type="button" onClick={() => { void signOut(); setSession(null) }}>Keluar dari akun</button>
            </>
          ) : (
            <>
              <h2 id="auth-panel-title">Simpan hasil di akun Google.</h2>
              <p>Login hanya diperlukan bila Anda ingin menyimpan hasil skrining. Anda tetap dapat menggunakan NAYANA tanpa akun.</p>
              <button className="app-google-action" disabled={pending} onClick={beginGoogleLogin} type="button">{pending ? 'Mengarahkan ke Google…' : 'Lanjut dengan Google'}</button>
            </>
          )}
          {message && <p className="app-auth__message" role="status">{message}</p>}
          <Link className="app-text-action" to="/screening">Kembali ke skrining tanpa akun</Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
