import { useEffect, useRef, useState } from 'react'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import { PersonalScreeningPanel } from './PersonalScreeningPage'
import { getAuthSession, type AuthSession } from '../lib/supabase-auth'
import { getGuestHistory } from '../lib/screening-history'
import { Link } from '@tanstack/react-router'

function firstName(name: string | null) {
  return name?.trim().split(/\s+/)[0] || 'Anda'
}

export function ScreeningPage() {
  const welcomeHandled = useRef(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [welcomeSession] = useState<AuthSession | null>(() => {
    const isWelcome = new URLSearchParams(window.location.search).get('welcome') === '1'
    return isWelcome ? getAuthSession() : null
  })
  const [localHistoryCount] = useState(() => getGuestHistory().length)

  useEffect(() => {
    if (!welcomeSession || welcomeHandled.current) return
    welcomeHandled.current = true
    window.history.replaceState({}, document.title, window.location.pathname)
  }, [welcomeSession])

  return (
    <div className="app-page">
      <SiteHeader />
      <main className={isProcessing ? 'app-shell app-screening app-screening--processing' : 'app-shell app-screening'}>
        {!isProcessing && (
          <>
            <section className="app-screening__intro" aria-labelledby="screening-title">
              <p className="app-kicker">Mulai skrining</p>
              <h2 id="screening-title">Mulai dari foto fundus.</h2>
              <p>
                Pilih foto fundus atau contoh untuk memulai. Hasil menunjukkan kategori dengan pola paling mirip,
                bukan diagnosis medis.
              </p>
              {localHistoryCount > 0 && (
                <Link className="app-screening__local-history" to="/history-local">
                  Lihat {localHistoryCount} hasil tersimpan di perangkat
                </Link>
              )}
            </section>

            {welcomeSession && (
              <section className="app-screening__welcome" aria-live="polite">
                <p>Selamat datang, {firstName(welcomeSession.displayName)}.</p>
                <span>Hasil yang Anda pilih untuk disimpan akan terhubung ke akun ini.</span>
              </section>
            )}
          </>
        )}

        <PersonalScreeningPanel onProcessingChange={setIsProcessing} />
      </main>
      {!isProcessing && <SiteFooter />}
    </div>
  )
}
