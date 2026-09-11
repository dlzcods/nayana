import { useEffect, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { demoCaseImageUrl, getScreeningResult, type ScreeningResult } from '../lib/screening-api'
import { getActiveScreening } from '../lib/screening-session'
import { SiteHeader } from '../components/SiteHeader'

export function ModelDetailPage() {
  const { screeningId } = useParams({ from: '/screening/results/$screeningId/detail' })
  const [result, setResult] = useState<ScreeningResult | null>(() => getActiveScreening(screeningId)?.screening || null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (result) return; void getScreeningResult(screeningId).then(setResult).catch((reason) => setError(reason instanceof Error ? reason.message : 'Detail hasil belum tersedia.')) }, [result, screeningId])
  return <div className="app-page"><SiteHeader /><main className="app-shell result-workspace result-workspace--compact">
    <Link className="result-document__back" to="/screening/results/$screeningId" params={{ screeningId }}><span aria-hidden="true">‹</span><span>Kembali ke hasil</span></Link>
    {error && <p className="result-workspace__error">{error}</p>}
    {result && <section className="model-detail" aria-labelledby="model-detail-title">
      <div className="model-detail__heading"><div><p className="app-kicker">Cara membaca hasil</p><h1 id="model-detail-title">Detail model</h1><p>Skor di bawah menunjukkan perbandingan pola pada foto fundus.</p></div>{demoCaseImageUrl(result.case_id || '') && <figure><img src={demoCaseImageUrl(result.case_id || '')} alt="Foto fundus yang dianalisis" /><figcaption>Foto fundus yang dianalisis</figcaption></figure>}</div>
      <div className="model-detail__plot" aria-label="Perbandingan kemiripan pola antar kategori">
        {result.predictions.map((item, index) => <div className={index === 0 ? 'is-leading' : ''} key={item.key}><span>{item.label}</span><i aria-hidden="true"><b style={{ width: `${Math.round(item.score * 100)}%` }} /></i><strong>{Math.round(item.score * 100)}%</strong></div>)}
      </div>
      <p className="model-detail__limit">Skor menunjukkan perbandingan kemiripan pola antar kategori model. Skor ini bukan peluang Anda memiliki kondisi tertentu.</p>
      <Link className="model-detail__learn" to="/screening/results/$screeningId" params={{ screeningId }}>Tentang cara membaca hasil <span aria-hidden="true">›</span></Link>
    </section>}
  </main></div>
}
