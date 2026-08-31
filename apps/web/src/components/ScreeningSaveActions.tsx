import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  saveAccountScreening,
  saveGuestHistory,
  type RetentionDays,
} from '../lib/screening-history'
import { getAuthSession, resolveAuthSession, type AuthSession } from '../lib/supabase-auth'
import { type ExecutiveSummary, type ScreeningResult } from '../lib/screening-api'

type ScreeningSaveActionsProps = {
  result: ScreeningResult
  summary: ExecutiveSummary | null
  normalizedImage?: Blob | null
  onSaved?: (destination: { kind: 'account'; recordId: string } | { kind: 'browser' }) => void
}

export function ScreeningSaveActions({ result, summary, normalizedImage, onSaved }: ScreeningSaveActionsProps) {
  const [retention, setRetention] = useState<RetentionDays>(30)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [session, setSession] = useState<AuthSession | null>(() => getAuthSession())
  const [isSessionLoading, setIsSessionLoading] = useState(() => Boolean(getAuthSession()))
  const hasAccount = Boolean(session?.userId)

  useEffect(() => {
    setState('idle')
    setMessage('')
  }, [result.screening_id])

  useEffect(() => {
    let active = true
    void resolveAuthSession()
      .then((nextSession) => { if (active) setSession(nextSession) })
      .finally(() => { if (active) setIsSessionLoading(false) })
    return () => { active = false }
  }, [])

  async function save() {
    setState('saving')
    setMessage('')
    try {
      if (hasAccount) {
        const saved = await saveAccountScreening({ result, summary, retentionDays: retention, normalizedImage })
        setMessage(saved.wasExisting ? 'Hasil ini sudah ada di riwayat akun Anda.' : `Hasil disimpan di akun selama ${retention} hari.`)
        onSaved?.({ kind: 'account', recordId: saved.record.id })
      } else {
        saveGuestHistory(result, summary)
        setMessage('Hasil disimpan di browser ini selama 3 hari. Foto tidak disimpan.')
        onSaved?.({ kind: 'browser' })
      }
      setState('saved')
    } catch (reason) {
      setState('error')
      setMessage(reason instanceof Error ? reason.message : 'Hasil belum dapat disimpan.')
    }
  }

  return (
    <section className="screening-save" aria-labelledby={`save-${result.screening_id}`}>
      <div>
        <p className="app-kicker">Simpan hasil</p>
        <h2 id={`save-${result.screening_id}`}>{hasAccount ? 'Simpan ke akun Anda.' : 'Simpan sementara di browser.'}</h2>
        <p>
          {hasAccount
            ? 'Foto yang Anda unggah disimpan privat bersama hasil. Anda dapat menghapusnya kapan saja dari akun.'
            : 'Tanpa akun, ringkasan hasil tersimpan lokal selama 3 hari. Foto tidak disimpan.'}
        </p>
      </div>
      {isSessionLoading ? (
        <div className="screening-save__controls screening-save__controls--loading" aria-live="polite">
          <span>Menyiapkan pilihan penyimpanan…</span>
        </div>
      ) : hasAccount ? (
        <div className="screening-save__controls">
          <label>
            <span>Masa simpan</span>
            <select value={retention} onChange={(event) => setRetention(Number(event.target.value) as RetentionDays)} disabled={state === 'saving' || state === 'saved'}>
              <option value={30}>30 hari</option>
              <option value={90}>90 hari</option>
            </select>
          </label>
          <button className="app-primary-action" type="button" onClick={() => { void save() }} disabled={state === 'saving' || state === 'saved'}>
            {state === 'saving' ? 'Menyimpan…' : state === 'saved' ? 'Tersimpan' : 'Simpan hasil'}
          </button>
          {state === 'saved' && <Link className="app-text-action" to="/history" search={{ hasil: undefined }}>Lihat riwayat skrining</Link>}
        </div>
      ) : (
        <div className="screening-save__controls">
          <button className="app-primary-action" type="button" onClick={() => { void save() }} disabled={state === 'saving' || state === 'saved'}>
            {state === 'saving' ? 'Menyimpan…' : state === 'saved' ? 'Tersimpan 3 hari' : 'Simpan 3 hari'}
          </button>
          <Link className="app-text-action" to="/login">Masuk untuk menyimpan di akun</Link>
        </div>
      )}
      {message && <p className={state === 'error' ? 'screening-save__message is-error' : 'screening-save__message'} role={state === 'error' ? 'alert' : undefined}>{message}</p>}
    </section>
  )
}
