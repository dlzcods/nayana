import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  saveAccountScreening,
  saveGuestHistory,
  updateAccountScreeningSummary,
  updateGuestHistorySummary,
  type RetentionDays,
} from '../lib/screening-history'
import { authChangeEvent, getAuthSession, type AuthSession } from '../lib/supabase-auth'
import { type ExecutiveSummary, type ScreeningResult } from '../lib/screening-api'
import { getActiveScreening, saveActiveScreening } from '../lib/screening-session'

type ScreeningSaveActionsProps = {
  result: ScreeningResult
  summary: ExecutiveSummary | null
  normalizedImage?: Blob | null
  initialDestination?: { kind: 'account'; recordId: string } | { kind: 'browser' } | null
  onSaved?: (destination: { kind: 'account'; recordId: string } | { kind: 'browser' }) => void
  purpose?: 'save-result' | 'unlock-chat'
}

export function ScreeningSaveActions({ result, summary, normalizedImage, initialDestination = null, onSaved, purpose = 'save-result' }: ScreeningSaveActionsProps) {
  const [retention, setRetention] = useState<RetentionDays>(30)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [savedDestination, setSavedDestination] = useState<{ kind: 'account'; recordId: string } | { kind: 'browser' } | null>(initialDestination)
  const [session, setSession] = useState<AuthSession | null>(() => getAuthSession())
  const hasAccount = Boolean(session?.userId)

  useEffect(() => {
    if (initialDestination) {
      setSavedDestination(initialDestination)
      setState('saved')
      setMessage(initialDestination.kind === 'account' ? 'Hasil skrining sudah tersimpan di akun Anda.' : 'Hasil skrining tersimpan di perangkat ini selama 3 hari.')
      const active = getActiveScreening(result.screening_id)
      if (active && !active.savedDestination) saveActiveScreening({ ...active, savedDestination: initialDestination })
      return
    }
    setSavedDestination(null)
    setState('idle')
    setMessage('')
  }, [initialDestination, result.screening_id])

  useEffect(() => {
    if (!summary || !savedDestination) return
    if (savedDestination.kind === 'browser') {
      updateGuestHistorySummary(result.screening_id, summary)
      return
    }
    void updateAccountScreeningSummary(savedDestination.recordId, summary).catch(() => undefined)
  }, [result.screening_id, savedDestination, summary])

  useEffect(() => {
    const syncSession = () => setSession(getAuthSession())
    window.addEventListener(authChangeEvent, syncSession)
    return () => window.removeEventListener(authChangeEvent, syncSession)
  }, [])

  async function save() {
    setState('saving')
    setMessage('')
    try {
      if (hasAccount) {
        const saved = await saveAccountScreening({ result, summary, retentionDays: retention, normalizedImage })
        setMessage(saved.wasExisting ? 'Hasil ini sudah ada di riwayat akun Anda.' : `Hasil disimpan di akun selama ${retention} hari.`)
        const destination = { kind: 'account' as const, recordId: saved.record.id }
        setSavedDestination(destination)
        const active = getActiveScreening(result.screening_id)
        if (active) saveActiveScreening({ ...active, savedDestination: destination })
        onSaved?.(destination)
      } else {
        saveGuestHistory(result, summary)
        setMessage('Hasil disimpan di perangkat ini selama 3 hari. Foto tidak disimpan.')
        const destination = { kind: 'browser' as const }
        setSavedDestination(destination)
        const active = getActiveScreening(result.screening_id)
        if (active) saveActiveScreening({ ...active, savedDestination: destination })
        onSaved?.(destination)
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
        <p className="app-kicker">{purpose === 'unlock-chat' ? 'Simpan untuk berdiskusi' : 'Simpan untuk nanti'}</p>
        <h2 id={`save-${result.screening_id}`}>{purpose === 'unlock-chat' ? 'Simpan hasil untuk membuka Tanya NAYANA.' : hasAccount ? 'Simpan hasil di akun selama 30 atau 90 hari.' : 'Simpan di perangkat ini selama 3 hari.'}</h2>
        <p>
          {purpose === 'unlock-chat'
            ? hasAccount
              ? 'Hasil yang tersimpan dapat dibuka kembali bersama ruang percakapannya. Foto yang Anda unggah tersimpan privat di akun.'
              : 'Hasil dapat disimpan di browser selama 3 hari untuk membuka ruang percakapan. Foto tidak disimpan.'
            : hasAccount
            ? 'Foto yang Anda unggah disimpan privat bersama hasil selama masa yang Anda pilih. Anda dapat menghapusnya kapan saja.'
            : 'Tanpa akun, ringkasan teks tersimpan di perangkat ini selama 3 hari. Foto tidak disimpan.'}
        </p>
      </div>
      {hasAccount ? (
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
            {state === 'saving' ? 'Menyimpan…' : state === 'saved' ? 'Tersimpan di perangkat ini' : 'Simpan 3 hari'}
          </button>
          {state === 'saved' && <Link className="app-text-action" to="/history-local">Lihat hasil di perangkat ini</Link>}
          <Link className="app-text-action" to="/login">Masuk untuk menyimpan di akun</Link>
        </div>
      )}
      {state === 'saved' && <p className="screening-save__success" role="status"><span aria-hidden="true">✓</span> Tersimpan</p>}
      {message && <p className={state === 'error' ? 'screening-save__message is-error' : 'screening-save__message'} role={state === 'error' ? 'alert' : undefined}>{message}</p>}
    </section>
  )
}
