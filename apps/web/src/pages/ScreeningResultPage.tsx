import { useEffect, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { BackArrowIcon } from '../components/BackArrowIcon'
import { ScreeningFinalizing } from '../components/ScreeningFinalizing'
import { ScreeningPdfAction } from '../components/ScreeningPdfAction'
import { SiteHeader } from '../components/SiteHeader'
import {
  demoCaseIdFromScreeningId,
  demoCaseImageUrl,
  getExecutiveSummary,
  getScreeningResult,
  type ExecutiveSummary,
  type ScreeningResult,
} from '../lib/screening-api'
import { getActiveScreening, saveActiveScreening } from '../lib/screening-session'
import { getAuthSession } from '../lib/supabase-auth'
import { getGuestHistory } from '../lib/screening-history'

export function ScreeningResultPage() {
  const { screeningId } = useParams({ from: '/screening/results/$screeningId' })
  const [result, setResult] = useState<ScreeningResult | null>(null)
  const [pendingResult, setPendingResult] = useState<ScreeningResult | null>(null)
  const [summary, setSummary] = useState<ExecutiveSummary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSaved, setIsSaved] = useState(false)
  const [leaveWarning, setLeaveWarning] = useState(false)

  useEffect(() => {
    let active = true

    setResult(null)
    setPendingResult(null)
    setSummary(null)
    setSummaryError(null)
    setError(null)
    setIsSaved(false)
    setLeaveWarning(false)

    void (async () => {
      const cached = getActiveScreening(screeningId)
      if (cached) {
        if (active) {
          setResult(cached.screening)
          setSummary(cached.summary)
          setIsSaved(Boolean(cached.savedDestination) || getGuestHistory().some((item) => item.result.screening_id === screeningId))
        }
        return
      }

      try {
        const response = await getScreeningResult(screeningId)
        if (active) setPendingResult(response)
        let nextSummary: ExecutiveSummary | null = null
        let nextSummaryError: string | null = null

        try {
          nextSummary = await getExecutiveSummary(response)
        } catch (reason) {
          nextSummaryError = reason instanceof Error ? reason.message : 'Ringkasan belum tersedia.'
        }

        if (active) {
          setResult(response)
          setPendingResult(null)
          setSummary(nextSummary)
          setSummaryError(nextSummaryError)
          saveActiveScreening({ screening: response, summary: nextSummary })
          setIsSaved(getGuestHistory().some((item) => item.result.screening_id === screeningId))
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Hasil demo belum tersedia.')
      }
    })()

    return () => { active = false }
  }, [screeningId])

  const chartPredictions = result?.predictions.slice(0, 4) || []
  const summaryText = result
    ? summary
      ? summary.general_information || summary.overview
      : summaryError
        ? `Model menemukan pola pada foto fundus yang paling mirip dengan kategori ${result.top_prediction.label.toLowerCase()}. Kategori ini perlu dipahami bersama keluhan, riwayat kesehatan, dan pemeriksaan langsung oleh dokter mata.`
        : 'Ringkasan sedang disiapkan dari hasil model.'
    : ''

  const leavePath = getAuthSession() ? '/history' : '/history-local'

  function requestBack() {
    if (isSaved) return
    setLeaveWarning(true)
  }

  return (
    <div className="app-page">
      <SiteHeader />
      <main className={`app-shell app-result result-document ${!result && !error ? 'app-result--loading' : ''}`}>
        {!result && !error && (
          <ScreeningFinalizing
            source="demo"
            imageUrl={demoCaseImageUrl(
              pendingResult?.case_id || demoCaseIdFromScreeningId(screeningId) || '',
            )}
          />
        )}

        {error && (
          <section className="app-empty" aria-labelledby="result-error-title">
            <p className="app-kicker">Mode contoh</p>
            <h1 id="result-error-title">Hasil contoh sudah tidak tersedia.</h1>
            <p>{error}</p>
            <Link className="app-primary-action app-primary-action--back" to="/screening">
              <BackArrowIcon />
              Kembali ke pilihan foto
            </Link>
          </section>
        )}

        {result && (
          <section className="result-document__body" aria-labelledby="result-title">
            {isSaved ? (
              <Link className="result-document__back" to={getAuthSession() ? '/history' : '/history-local'} search={getAuthSession() ? { hasil: undefined } : undefined} aria-label="Kembali ke riwayat skrining"><BackArrowIcon /><span>Kembali ke riwayat</span></Link>
            ) : (
              <button className="result-document__back result-document__back--button" type="button" onClick={requestBack} aria-label="Kembali ke riwayat skrining"><BackArrowIcon /><span>Kembali ke riwayat</span></button>
            )}
            <div className="result-document__intro">
              <p className="app-kicker">{result.source === 'demo' ? 'Mode contoh' : 'Skrining awal'}</p>
              <h1 id="result-title">Hasil skrining Anda</h1>
              <p>Ringkasan singkat untuk membantu Anda memahami hasil dan menyiapkan percakapan dengan dokter mata.</p>
            </div>

            <section className="result-evidence" aria-labelledby="model-result-title">
              {demoCaseImageUrl(result.case_id || '') && <figure className="result-evidence__image">
                <img src={demoCaseImageUrl(result.case_id || '')} alt="Foto fundus contoh yang dianalisis" />
              </figure>}
              <div className="result-evidence__reading">
                <p className="app-kicker">Indikasi model</p>
                <h2 id="model-result-title">Pola paling mirip dengan {result.top_prediction.label.toLowerCase()}.</h2>
                <p className="result-evidence__score"><strong>{Math.round(result.top_prediction.score * 100)}%</strong><span>kemiripan pola tertinggi pada kategori ini.</span></p>
                <p className="result-evidence__limit">Skor ini membandingkan pola pada model, bukan peluang Anda memiliki kondisi tertentu.</p>
              </div>
            </section>

            <section className="result-report__grid" aria-label="Rincian hasil">
              <section className="result-report__comparison" aria-labelledby="comparison-title">
                <div className="result-report__card-head">
                  <div><p className="app-kicker" id="comparison-title">Perbandingan kategori</p><p className="result-report__microcopy">kemiripan pola</p></div>
                  <span className="result-report__count">{chartPredictions.length} kategori</span>
                </div>
                <div className="result-category-lines" role="img" aria-label="Garis perbandingan kemiripan pola antar kategori">
                  {chartPredictions.map((prediction) => <div key={prediction.key} className={prediction.key === result.top_prediction.key ? 'result-category-line is-leading' : 'result-category-line'}>
                    <div className="result-category-line__meta"><span>{prediction.label}</span><b>{Math.round(prediction.score * 100)}%</b></div>
                    <i aria-hidden="true"><b style={{ width: `${Math.round(prediction.score * 100)}%` }} /></i>
                  </div>)}
                </div>
                <p className="result-report__note">Perbandingan relatif antar kategori model.</p>
              </section>

              <section className="result-report__summary" aria-live="polite" aria-labelledby="summary-title">
                <p className="app-kicker" id="summary-title">Nayana AI Summary</p>
                <p className="result-report__summary-text">{summaryText}</p>
                <p className="result-report__disclaimer">Bukan diagnosis medis. Konfirmasi dengan dokter mata.</p>
              </section>
            </section>

            <section className="result-document__next">
              <div><p className="app-kicker">Jika Anda ingin lanjut</p><h2>Siapkan bahan diskusi dengan dokter.</h2><p className="result-document__next-copy">Pilih pertanyaan yang ingin dibawa. PDF hanya dibuat saat Anda memintanya.</p></div>
              <div className="result-document__next-actions">
                <Link className="app-primary-action" to="/screening/results/$screeningId/discussion" params={{ screeningId }}>Buka Doctor Kit</Link>
                <ScreeningPdfAction
                  className="result-document__pdf-action"
                  screening={result}
                  summary={summary}
                  imageUrl={demoCaseImageUrl(result.case_id || '') || null}
                />
              </div>
            </section>
          </section>
        )}
      </main>
      {leaveWarning && result && (
        <div className="app-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setLeaveWarning(false)
        }}>
          <section className="app-dialog app-dialog--leave" role="dialog" aria-modal="true" aria-labelledby="leave-result-title" aria-describedby="leave-result-description">
            <p className="app-kicker">Hasil belum tersimpan</p>
            <h2 id="leave-result-title">Simpan hasil sebelum kembali?</h2>
            <p id="leave-result-description">Hasil ini masih berada di sesi skrining. Jika Anda keluar sekarang, hasil tersebut dapat hilang.</p>
            <div className="app-dialog__actions app-dialog__actions--leave">
              <Link className="app-primary-action" to="/screening/results/$screeningId/discussion" params={{ screeningId }} onClick={() => setLeaveWarning(false)}>Buka Doctor Kit</Link>
              <button className="app-secondary-action" type="button" onClick={() => window.location.assign(leavePath)}>Tetap keluar</button>
              <button className="app-text-action" type="button" onClick={() => setLeaveWarning(false)}>Batal</button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
