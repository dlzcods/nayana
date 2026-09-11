import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { BackArrowIcon } from '../components/BackArrowIcon'
import { demoCaseImageUrl, downloadScreeningPdf, getExecutiveSummary, getScreeningResult, type ExecutiveSummary, type ScreeningResult } from '../lib/screening-api'
import { discussionQuestionsFor } from '../lib/discussion-questions'
import { getActiveScreening, saveActiveScreening, setActiveScreeningChatAccess } from '../lib/screening-session'
import { getAccountScreeningByOrigin, getGuestHistory } from '../lib/screening-history'
import { ScreeningSaveActions } from '../components/ScreeningSaveActions'
import { SiteHeader } from '../components/SiteHeader'

export function DoctorKitPage() {
  const { screeningId } = useParams({ from: '/screening/results/$screeningId/discussion' })
  const navigate = useNavigate()
  const cached = getActiveScreening(screeningId)
  const [screening, setScreening] = useState<ScreeningResult | null>(cached?.screening || null)
  const [summary, setSummary] = useState<ExecutiveSummary | null>(cached?.summary || null)
  const [selected, setSelected] = useState<string[]>(cached?.discussionQuestions || [])
  const [savedDestination, setSavedDestination] = useState<{ kind: 'account'; recordId: string } | { kind: 'browser' } | null>(() => getGuestHistory().some((item) => item.result.screening_id === screeningId) ? { kind: 'browser' } : null)
  const [error, setError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [includeImage, setIncludeImage] = useState(false)
  const [exportState, setExportState] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const result = screening || await getScreeningResult(screeningId)
        const nextSummary = summary || await getExecutiveSummary(result).catch(() => null)
        if (active) { setScreening(result); setSummary(nextSummary); saveActiveScreening({ ...getActiveScreening(screeningId), screening: result, summary: nextSummary, discussionQuestions: selected }) }
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : 'Persiapan konsultasi belum tersedia.') }
    })()
    return () => { active = false }
  // Context is loaded once for this result; question selections are saved separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screeningId])

  useEffect(() => {
    let active = true
    void getAccountScreeningByOrigin(screeningId).then((record) => {
      if (active && record) setSavedDestination({ kind: 'account', recordId: record.id })
    }).catch(() => undefined)
    return () => { active = false }
  }, [screeningId])

  function setQuestions(next: string[]) {
    setSelected(next)
    const active = getActiveScreening(screeningId)
    if (active) saveActiveScreening({ ...active, discussionQuestions: next })
  }

  async function exportPdf() {
    if (!screening) return
    setExportState('loading'); setError(null)
    try {
      let fundusImage: Blob | undefined
      const imageUrl = includeImage ? demoCaseImageUrl(screening.case_id || '') : ''
      if (imageUrl) { const response = await fetch(imageUrl); if (!response.ok) throw new Error('Foto fundus belum dapat dimuat untuk PDF.'); fundusImage = await response.blob() }
      const questions = discussionQuestionsFor(screening).filter((item) => selected.includes(item.question))
      const blob = await downloadScreeningPdf({ screening, summary, fundusImage, discussionQuestions: questions })
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'nayana-ringkasan-skrining.pdf'; anchor.click(); URL.revokeObjectURL(url)
      setExportOpen(false)
    } catch (reason) { setExportState('error'); setError(reason instanceof Error ? reason.message : 'PDF belum dapat dibuat.') } finally { setExportState('idle') }
  }

  return <div className="app-page"><SiteHeader /><main className="app-shell result-workspace result-workspace--compact">
    <Link className="result-document__back" to="/screening/results/$screeningId" params={{ screeningId }}><BackArrowIcon /><span>Kembali ke hasil</span></Link>
    {error && <p className="result-workspace__error" role="alert">{error}</p>}
    {screening && <section className="doctor-kit" aria-labelledby="doctor-kit-title">
      <div className="doctor-kit__intro"><p className="app-kicker">Doctor Kit</p><h1 id="doctor-kit-title">Siapkan diskusi dengan dokter</h1><p>Pilih hal yang ingin Anda tanyakan. Anda dapat membuat PDF kapan saja.</p></div>
      <section className="doctor-kit__summary"><p className="app-kicker">Nayana AI Summary</p><p>{summary?.general_information || summary?.overview || 'Model menemukan pola pada foto fundus yang perlu dipahami bersama keluhan, riwayat kesehatan, dan pemeriksaan langsung oleh dokter mata.'}</p><p className="doctor-kit__disclaimer">Bukan diagnosis medis. Konfirmasi dengan dokter mata.</p></section>
      <section className="doctor-kit__questions" aria-labelledby="doctor-kit-questions"><h2 id="doctor-kit-questions">Pertanyaan untuk Sp.M</h2>{discussionQuestionsFor(screening).map((item) => <label key={item.id}><input type="checkbox" checked={selected.includes(item.question)} onChange={() => setQuestions(selected.includes(item.question) ? selected.filter((question) => question !== item.question) : [...selected, item.question])} /><span>{item.question}</span></label>)}</section>
      <ScreeningSaveActions result={screening} summary={summary} initialDestination={savedDestination} onSaved={setSavedDestination} />
      <button className={savedDestination ? 'doctor-kit__chat' : 'doctor-kit__chat is-locked'} type="button" disabled={!savedDestination} onClick={() => {
        if (!savedDestination) return
        if (savedDestination.kind === 'account') {
          void navigate({ to: '/history/$recordId/chat', params: { recordId: savedDestination.recordId } })
          return
        }
        setActiveScreeningChatAccess(screeningId, 'temporary')
        void navigate({ to: '/screening/results/$screeningId/chat', params: { screeningId } })
      }}> <span><b>Tanya NAYANA</b><small>{savedDestination ? 'Buka ruang percakapan hasil ini' : 'Simpan hasil dulu untuk membuka chat'}</small></span><i aria-hidden="true">›</i></button>
      <button className="doctor-kit__export" type="button" onClick={() => setExportOpen(true)}>Buat ringkasan PDF <span>(opsional)</span></button>
    </section>}
  </main>{exportOpen && screening && <div className="export-sheet-backdrop" role="presentation"><section className="export-sheet" role="dialog" aria-modal="true" aria-labelledby="export-title"><button className="export-sheet__close" type="button" onClick={() => setExportOpen(false)} aria-label="Tutup">×</button><p className="export-sheet__handle" aria-hidden="true" /><p className="app-kicker">Ekspor opsional</p><h2 id="export-title">Ringkasan untuk konsultasi</h2><p>Tinjau isi ringkasan sebelum mengunduh.</p><div className="export-sheet__items"><label><input type="checkbox" checked disabled /><span>Hasil skrining dan batasannya</span></label><label><input type="checkbox" checked={selected.length > 0} disabled /><span>Pertanyaan dokter ({selected.length} dipilih)</span></label>{demoCaseImageUrl(screening.case_id || '') && <label><input type="checkbox" checked={includeImage} onChange={(event) => setIncludeImage(event.target.checked)} /><span>Sertakan foto fundus (opsional)</span></label>}</div><button className="app-primary-action" type="button" disabled={exportState === 'loading'} onClick={() => { void exportPdf() }}>{exportState === 'loading' ? 'Menyiapkan PDF…' : 'Unduh PDF'}</button></section></div>}</div>
}
