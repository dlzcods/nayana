import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import { BackArrowIcon } from '../components/BackArrowIcon'
import { ExecutiveSummaryCard } from '../components/ExecutiveSummaryCard'
import { ScreeningChat } from '../components/ScreeningChat'
import { ScreeningFinalizing } from '../components/ScreeningFinalizing'
import { ScreeningPdfAction } from '../components/ScreeningPdfAction'
import { ScreeningSaveActions } from '../components/ScreeningSaveActions'
import {
  demoCaseIdFromScreeningId,
  demoCaseImageUrl,
  getExecutiveSummary,
  getScreeningResult,
  type ExecutiveSummary,
  type ScreeningResult,
} from '../lib/screening-api'
import { getActiveScreening, saveActiveScreening } from '../lib/screening-session'

export function ScreeningResultPage() {
  const { screeningId } = useParams({ from: '/screening/results/$screeningId' })
  const [result, setResult] = useState<ScreeningResult | null>(null)
  const [pendingResult, setPendingResult] = useState<ScreeningResult | null>(null)
  const [summary, setSummary] = useState<ExecutiveSummary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedDestination, setSavedDestination] = useState<{ kind: 'account'; recordId: string } | { kind: 'browser' } | null>(null)
  const resultDetailRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let active = true

    setResult(null)
    setPendingResult(null)
    setSummary(null)
    setSummaryError(null)
    setError(null)
    setSavedDestination(null)

    void (async () => {
      const cached = getActiveScreening(screeningId)
      if (cached) {
        if (active) {
          setResult(cached.screening)
          setSummary(cached.summary)
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
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Hasil demo belum tersedia.')
      }
    })()

    return () => { active = false }
  }, [screeningId])

  useEffect(() => {
    if (!result || !resultDetailRef.current) return
    const timer = window.setTimeout(() => {
      window.scrollTo({ top: Math.max(0, resultDetailRef.current!.offsetTop - 104), behavior: 'auto' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [result])

  return (
    <div className="app-page">
      <SiteHeader />
      <main className={`app-shell app-result ${!result && !error ? 'app-result--loading' : ''}`}>
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
          <>
            <section className="app-result__intro" aria-labelledby="result-title">
              <p className="app-kicker">Hasil skrining awal</p>
              <h1 id="result-title">Pola paling mirip dengan {result.top_prediction.label.toLowerCase()}.</h1>
              <p>
                Berikut adalah hasil dari contoh fundus yang dipilih. Persentase menunjukkan kemiripan pola
                dalam kategori model.
              </p>
            </section>

            <section ref={resultDetailRef} className="screening-result" aria-label="Rincian hasil skrining contoh">
              <figure className="screening-result__image">
                <img src={demoCaseImageUrl(result.case_id || '')} alt="Foto fundus contoh yang dianalisis" />
                <figcaption>Foto fundus contoh untuk demonstrasi NAYANA.</figcaption>
              </figure>

              <div className="screening-result__data">
                <p className="screening-result__eyebrow">Indikasi model</p>
                <h2>{result.top_prediction.label}</h2>
                <div className="screening-result__rows" aria-label="Perbandingan kemiripan pola">
                  {result.predictions.map((prediction, index) => (
                    <div className={index === 0 ? 'screening-row screening-row--primary' : 'screening-row'} key={prediction.key}>
                      <span>{prediction.label}</span>
                      <i aria-hidden="true"><b style={{ width: `${Math.round(prediction.score * 100)}%` }} /></i>
                      <strong>{Math.round(prediction.score * 100)}%</strong>
                    </div>
                  ))}
                </div>
              </div>

              <ExecutiveSummaryCard screening={result} summary={summary} error={summaryError} />

              <ScreeningSaveActions result={result} summary={summary} onSaved={setSavedDestination} />

              <ScreeningChat screening={result} summary={summary} savedDestination={savedDestination} />

              <div className="screening-result__next">
                <div>
                  <span>Langkah selanjutnya</span>
                  <p>Bawa hasil awal ini kepada dokter spesialis mata (Sp.M) untuk pemeriksaan lebih menyeluruh.</p>
                </div>
                <Link className="app-primary-action app-primary-action--back" to="/screening">
                  <BackArrowIcon />
                  Pilih foto atau contoh lain
                </Link>
              </div>

              <ScreeningPdfAction screening={result} summary={summary} />

              <p className="screening-result__disclaimer">{result.disclaimer}</p>
            </section>
          </>
        )}
      </main>
      {(result || error) && <SiteFooter />}
    </div>
  )
}
