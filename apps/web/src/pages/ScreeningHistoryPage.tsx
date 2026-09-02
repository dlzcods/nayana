import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import { BackArrowIcon } from '../components/BackArrowIcon'
import { ScreeningPdfAction } from '../components/ScreeningPdfAction'
import { DiscussionKit } from '../components/DiscussionKit'
import { discussionQuestionsFor } from '../lib/discussion-questions'
import {
  deleteAccountHistory,
  getAccountHistory,
  getAccountPhoto,
  screeningFromHistory,
  type HistoryFilters,
  type ScreeningHistoryItem,
} from '../lib/screening-history'
import { getAuthSession, resolveAuthSession } from '../lib/supabase-auth'
import { demoCaseIdFromScreeningId, demoCaseImageUrl } from '../lib/screening-api'

const indicationOptions = [
  { value: 'all', label: 'Semua indikasi' },
  { value: 'normal', label: 'Kategori normal' },
  { value: 'cataract', label: 'Katarak' },
  { value: 'glaucoma', label: 'Glaukoma' },
  { value: 'diabetic_retinopathy', label: 'Retinopati diabetik' },
]

function formatDate(value: string) {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

function percentage(value: number) {
  return `${Math.round(value * 100)}%`
}

export function ScreeningHistoryPage() {
  const navigate = useNavigate({ from: '/history' })
  const { hasil: selectedIdFromUrl } = useSearch({ from: '/history' })
  const selectedIdRef = useRef(selectedIdFromUrl)
  const [history, setHistory] = useState<ScreeningHistoryItem[]>([])
  const [filters, setFilters] = useState<HistoryFilters>({ period: 'all', indication: 'all', query: '' })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [photo, setPhoto] = useState<{ recordId: string; url: string | null; status: 'idle' | 'loading' | 'ready' | 'unavailable' }>({ recordId: '', url: null, status: 'idle' })
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [discussionQuestions, setDiscussionQuestions] = useState<string[]>([])

  useEffect(() => { selectedIdRef.current = selectedIdFromUrl }, [selectedIdFromUrl])

  useEffect(() => {
    if (!getAuthSession()) {
      window.location.replace('/login')
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      setIsLoading(true)
      setError(null)
      void resolveAuthSession()
        .then((session) => {
          if (!session?.userId) throw new Error('Sesi akun sudah berakhir. Masuk kembali untuk membuka riwayat.')
          return getAccountHistory(filters)
        })
        .then((records) => {
          if (!active) return
          setHistory(records)
          const selectedStillExists = Boolean(selectedIdRef.current && records.some((record) => record.id === selectedIdRef.current))
          if (!selectedStillExists && records[0]?.id) {
            void navigate({ search: { hasil: records[0].id }, replace: true, resetScroll: false })
          }
          if (!records.length && selectedIdRef.current) {
            void navigate({ search: { hasil: undefined }, replace: true, resetScroll: false })
          }
        })
        .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Riwayat belum dapat dimuat.') })
        .finally(() => { if (active) setIsLoading(false) })
    }, filters.query ? 280 : 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [filters, navigate])

  const selected = useMemo(
    () => history.find((record) => record.id === selectedIdFromUrl) || history[0] || null,
    [history, selectedIdFromUrl],
  )
  const selectedDemoImageUrl = selected?.source === 'demo'
    ? demoCaseImageUrl(demoCaseIdFromScreeningId(selected.origin_screening_id || '') || '')
    : ''
  const selectedId = selected?.id || ''
  const selectedPhotoPath = selected?.photo_path || null
  const selectedPhotoUrl = photo.recordId === selected?.id ? photo.url : null

  useEffect(() => {
    if (selected) setDiscussionQuestions(discussionQuestionsFor(screeningFromHistory(selected)).map((item) => item.question))
    else setDiscussionQuestions([])
  }, [selected])

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | null = null
    if (!selectedId || !selectedPhotoPath) {
      setPhoto({ recordId: selectedId, url: null, status: 'unavailable' })
      return () => controller.abort()
    }
    setPhoto({ recordId: selectedId, url: null, status: 'loading' })
    void getAccountPhoto({ photo_path: selectedPhotoPath }, controller.signal)
      .then((url) => {
        if (controller.signal.aborted) {
          if (url) URL.revokeObjectURL(url)
          return
        }
        objectUrl = url
        setPhoto({ recordId: selectedId, url, status: url ? 'ready' : 'unavailable' })
      })
      .catch((reason) => {
        if (controller.signal.aborted) return
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setPhoto({ recordId: selectedId, url: null, status: 'unavailable' })
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [selectedId, selectedPhotoPath])

  function selectRecord(recordId: string) {
    void navigate({ search: { hasil: recordId }, replace: true, resetScroll: false })
  }

  async function removeSelected() {
    if (!selected || !window.confirm('Hapus hasil ini beserta foto privat dan percakapannya dari akun?')) return
    setDeletingId(selected.id)
    setError(null)
    try {
      await deleteAccountHistory(selected)
      const remaining = history.filter((record) => record.id !== selected.id)
      setHistory(remaining)
      const nextSelected = remaining[0] || null
      void navigate({ search: { hasil: nextSelected?.id }, replace: true, resetScroll: false })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Hasil belum dapat dihapus.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="app-page">
      <SiteHeader />
      <main className="app-shell app-history-page">
        <section className="app-history-page__intro" aria-labelledby="history-page-title">
          <p className="app-kicker">Riwayat skrining</p>
          <h1 id="history-page-title">Hasil Anda, tersusun rapi.</h1>
          <p>Buka hasil yang tersimpan untuk melihat kembali ringkasan, kemiripan pola, dan percakapan terkait.</p>
        </section>

        {error && <p className="app-history-page__status is-error" role="alert">{error}</p>}
        {isLoading && <p className="app-history-page__status" aria-live="polite">Memuat riwayat skrining…</p>}
        {!isLoading && !error && history.length === 0 && (
          <section className="app-history-page__empty">
            <p className="app-kicker">Belum ada hasil</p>
            <h2>Riwayat akan tampil di sini.</h2>
            <p>Simpan satu hasil skrining ke akun untuk membuka kembali detail dan melanjutkan percakapan.</p>
            <Link className="app-primary-action" to="/screening">Mulai skrining</Link>
          </section>
        )}

        {!isLoading && history.length > 0 && (
          <div className="app-history-workspace">
            <section className="app-history-list" aria-label="Daftar hasil tersimpan">
              <div className="app-history-list__head">
                <p>{history.length} hasil tersimpan</p>
                <button type="button" aria-expanded={filtersOpen} aria-controls="history-filter" onClick={() => setFiltersOpen((current) => !current)}>
                  Filter
                </button>
              </div>
              {filtersOpen && (
                <section className="app-history-filter app-history-filter--embedded" id="history-filter" aria-label="Filter riwayat skrining">
                  <label>
                    <span className="sr-only">Cari hasil</span>
                    <input value={filters.query || ''} placeholder="Cari indikasi" onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} />
                  </label>
                  <label>
                    <span className="sr-only">Rentang waktu</span>
                    <select value={filters.period || 'all'} onChange={(event) => setFilters((current) => ({ ...current, period: event.target.value as HistoryFilters['period'] }))}>
                      <option value="all">Semua waktu</option>
                      <option value="7d">7 hari terakhir</option>
                      <option value="30d">30 hari terakhir</option>
                      <option value="90d">90 hari terakhir</option>
                    </select>
                  </label>
                  <label>
                    <span className="sr-only">Indikasi model</span>
                    <select value={filters.indication || 'all'} onChange={(event) => setFilters((current) => ({ ...current, indication: event.target.value }))}>
                      {indicationOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                </section>
              )}
              <div>
                {history.map((record) => (
                  <button className={record.id === selected?.id ? 'is-selected' : ''} type="button" key={record.id} onClick={() => selectRecord(record.id)}>
                    <span className="app-history-list__mark" aria-hidden="true">{record.source === 'upload' ? 'F' : 'C'}</span>
                    <span>
                      <small>{formatDate(record.created_at)} · {record.source === 'upload' ? 'Foto Anda' : 'Contoh'}</small>
                      <strong>{record.top_prediction_label}</strong>
                      <em>{percentage(record.predictions.find((item) => item.key === record.top_prediction_key)?.score || 0)} kemiripan pola</em>
                    </span>
                    <i aria-hidden="true">›</i>
                  </button>
                ))}
              </div>
            </section>

            {selected && (
              <section className="app-history-detail" aria-labelledby={`history-detail-${selected.id}`}>
                <div className="app-history-detail__hero">
                  <div className="app-history-detail__visual" aria-busy={photo.recordId === selected.id && photo.status === 'loading'}>
                    {selectedPhotoUrl || selectedDemoImageUrl ? <img src={selectedPhotoUrl || selectedDemoImageUrl} alt={selectedPhotoUrl ? 'Foto fundus yang disimpan bersama hasil ini' : 'Foto fundus contoh yang dipilih'} /> : (
                      <div className="app-history-detail__photo-empty">
                        {photo.recordId === selected.id && photo.status === 'loading' ? 'Memuat foto…' : selected.photo_path ? 'Foto privat tidak tersedia' : 'Tidak ada foto tersimpan'}
                      </div>
                    )}
                  </div>
                  <div className="app-history-detail__hero-copy">
                    <p className="app-kicker">Hasil skrining awal</p>
                    <h2 id={`history-detail-${selected.id}`}>Pola tertinggi: {selected.top_prediction_label}</h2>
                    <p className="app-history-detail__score">{percentage(selected.predictions.find((item) => item.key === selected.top_prediction_key)?.score || 0)} kemiripan pola</p>

                    <div className="app-history-detail__probabilities" aria-label="Seluruh kemiripan pola">
                      {selected.predictions.map((prediction) => (
                        <div className={prediction.key === selected.top_prediction_key ? 'is-primary' : ''} key={prediction.key}>
                          <span>{prediction.label}</span>
                          <i><b style={{ width: `${Math.max(2, prediction.score * 100)}%` }} /></i>
                          <strong>{percentage(prediction.score)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="app-history-detail__content">
                  {selected.executive_summary && (
                    <div className="app-history-detail__summary">
                      <h3>{selected.executive_summary.title}</h3>
                      <p>{selected.executive_summary.overview}</p>
                      <p>{selected.executive_summary.next_step}</p>
                    </div>
                  )}

                  <DiscussionKit
                    screening={screeningFromHistory(selected)}
                    selectedQuestions={discussionQuestions}
                    onChange={setDiscussionQuestions}
                  />

                  <ScreeningPdfAction
                    className="app-history-detail__pdf"
                    screening={screeningFromHistory(selected)}
                    summary={selected.executive_summary}
                    imageUrl={selectedPhotoUrl || selectedDemoImageUrl || null}
                    imageDownloadName={selected.source === 'upload'
                      ? 'nayana-foto-fundus-' + selected.id + '.jpg'
                      : 'nayana-gambar-contoh-' + selected.id + (selectedDemoImageUrl.endsWith('.jpg') ? '.jpg' : '.png')}
                    imageDownloadLabel={selected.source === 'upload' ? 'Unduh foto fundus (JPEG)' : 'Unduh gambar contoh'}
                    showImageOptions
                    discussionQuestions={discussionQuestions}
                  />
                  <p className="app-history-detail__note">Hasil ini adalah skrining awal dari satu foto fundus. Persentase menunjukkan kemiripan pola, bukan tingkat keparahan.</p>
                  <div className="app-history-detail__actions">
                    <Link className="app-primary-action" to="/history/$recordId/chat" params={{ recordId: selected.id }}>Mulai diskusi</Link>
                    <button className="app-text-action app-text-action--danger" type="button" onClick={() => { void removeSelected() }} disabled={deletingId === selected.id}>
                      {deletingId === selected.id ? 'Menghapus…' : 'Hapus hasil'}
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        <Link className="app-history-page__back" to="/account"><BackArrowIcon /> Pengaturan akun</Link>
      </main>
      <SiteFooter />
    </div>
  )
}
