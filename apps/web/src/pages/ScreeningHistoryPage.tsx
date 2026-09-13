import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { SiteHeader } from '../components/SiteHeader'
import { BackArrowIcon } from '../components/BackArrowIcon'
import { ScreeningPdfAction } from '../components/ScreeningPdfAction'
import { DiscussionKit } from '../components/DiscussionKit'
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteTargets, setDeleteTargets] = useState<ScreeningHistoryItem[]>([])
  const [discussionQuestions, setDiscussionQuestions] = useState<string[]>([])
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)
  const deleteDialogRef = useRef<HTMLElement>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)

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
          setSelectedIds((current) => new Set([...current].filter((recordId) => records.some((record) => record.id === recordId))))
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
  const selectedRecords = useMemo(
    () => history.filter((record) => selectedIds.has(record.id)),
    [history, selectedIds],
  )
  const allRecordsSelected = history.length > 0 && selectedRecords.length === history.length
  const someRecordsSelected = selectedRecords.length > 0 && !allRecordsSelected

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someRecordsSelected
  }, [someRecordsSelected])

  useEffect(() => {
    setDiscussionQuestions([])
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

  useEffect(() => {
    if (!deleteTargets.length) return
    const focusTimer = window.setTimeout(() => cancelDeleteRef.current?.focus(), 0)
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isDeleting) setDeleteTargets([])
      if (event.key !== 'Tab') return
      const focusable = [...(deleteDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) || [])]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [deleteTargets, isDeleting])

  function selectRecord(recordId: string) {
    void navigate({ search: { hasil: recordId }, replace: true, resetScroll: false })
  }

  function toggleSelectAll() {
    setSelectedIds(allRecordsSelected ? new Set<string>() : new Set(history.map((record) => record.id)))
  }

  async function confirmDelete() {
    if (!deleteTargets.length) return
    setIsDeleting(true)
    setError(null)
    const deletedIds = new Set<string>()
    try {
      for (const record of deleteTargets) {
        await deleteAccountHistory(record)
        deletedIds.add(record.id)
      }
      const remaining = history.filter((record) => !deletedIds.has(record.id))
      setHistory(remaining)
      setSelectedIds((current) => new Set([...current].filter((recordId) => !deletedIds.has(recordId))))
      const nextSelected = remaining[0] || null
      void navigate({ search: { hasil: nextSelected?.id }, replace: true, resetScroll: false })
      setDeleteTargets([])
    } catch (reason) {
      if (deletedIds.size) {
        const remaining = history.filter((record) => !deletedIds.has(record.id))
        setHistory(remaining)
        setSelectedIds((current) => new Set([...current].filter((recordId) => !deletedIds.has(recordId))))
        void navigate({ search: { hasil: remaining[0]?.id }, replace: true, resetScroll: false })
        setError(`${deletedIds.size} hasil sudah dihapus. ${deleteTargets.length - deletedIds.size} hasil lainnya belum dapat dihapus.`)
      } else {
        setError(reason instanceof Error ? reason.message : 'Hasil belum dapat dihapus.')
      }
      setDeleteTargets([])
    } finally {
      setIsDeleting(false)
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
                <div>
                  <p>{history.length} hasil tersimpan</p>
                  <label className="app-history-list__select-all">
                    <input ref={selectAllRef} type="checkbox" aria-label="Pilih semua hasil yang ditampilkan" checked={allRecordsSelected} onChange={toggleSelectAll} />
                    <span>Pilih semua</span>
                  </label>
                </div>
                <button type="button" aria-expanded={filtersOpen} aria-controls="history-filter" onClick={() => setFiltersOpen((current) => !current)}>
                  Filter
                </button>
              </div>
              {selectedRecords.length > 0 && (
                <div className="app-history-list__selection" aria-live="polite">
                  <span>{selectedRecords.length} hasil dipilih</span>
                  <button className="app-text-action app-text-action--danger" type="button" onClick={() => setDeleteTargets(selectedRecords)} disabled={isDeleting}>Hapus pilihan</button>
                </div>
              )}
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
              <div className="app-history-list__records">
                {history.map((record) => (
                  <div className={`app-history-list__row${record.id === selected?.id ? ' is-selected' : ''}${selectedIds.has(record.id) ? ' is-checked' : ''}`} key={record.id}>
                    <button type="button" onClick={() => selectRecord(record.id)}>
                      <span className="app-history-list__mark" aria-hidden="true">{record.source === 'upload' ? 'F' : 'C'}</span>
                      <span>
                        <small>{formatDate(record.created_at)} · {record.source === 'upload' ? 'Foto Anda' : 'Contoh'}</small>
                        <strong>{record.top_prediction_label}</strong>
                        <em>{percentage(record.predictions.find((item) => item.key === record.top_prediction_key)?.score || 0)} kemiripan pola</em>
                      </span>
                      <i aria-hidden="true">›</i>
                    </button>
                  </div>
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
                    <h2 id={`history-detail-${selected.id}`}>Hasil skrining</h2>
                    <p className="app-history-detail__meta">{formatDate(selected.created_at)} · {selected.source === 'upload' ? 'Foto Anda' : 'Contoh fundus'}</p>
                    <div className="app-history-detail__indication">
                      <p className="app-kicker">Indikasi model</p>
                      <strong>{selected.top_prediction_label}</strong>
                      <p className="app-history-detail__score">{percentage(selected.predictions.find((item) => item.key === selected.top_prediction_key)?.score || 0)} <span>kemiripan pola</span></p>
                    </div>

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
                  <div className="app-history-detail__summary">
                    <p className="app-kicker">Nayana AI Summary</p>
                    <h3>Penjelasan umum {selected.top_prediction_label}</h3>
                    <p>{selected.executive_summary?.general_information || selected.executive_summary?.overview || `Kategori ${selected.top_prediction_label.toLowerCase()} memerlukan penilaian langsung oleh dokter mata bersama keluhan dan riwayat kesehatan.`}</p>
                    <p className="app-history-detail__disclaimer">Bukan diagnosis medis. Konfirmasi dengan dokter mata.</p>
                  </div>

                  <DiscussionKit
                    screening={screeningFromHistory(selected)}
                    selectedQuestions={discussionQuestions}
                    onChange={setDiscussionQuestions}
                  />

                  <div className="app-history-detail__actions">
                    <Link className="app-primary-action" to="/history/$recordId/chat" params={{ recordId: selected.id }}>Mulai diskusi</Link>
                    <ScreeningPdfAction
                      className="app-history-detail__pdf-action"
                      screening={screeningFromHistory(selected)}
                      summary={selected.executive_summary}
                      imageUrl={selectedPhotoUrl || selectedDemoImageUrl || null}
                      imageDownloadName={selected.source === 'upload'
                        ? 'nayana-foto-fundus-' + selected.id + '.jpg'
                        : 'nayana-gambar-contoh-' + selected.id + (selectedDemoImageUrl.endsWith('.jpg') ? '.jpg' : '.png')}
                      imageDownloadLabel={selected.source === 'upload' ? 'Unduh foto fundus (JPEG)' : 'Unduh gambar contoh'}
                      discussionQuestions={discussionQuestions}
                    />
                  </div>
                  <p className="app-history-detail__saved" role="status"><span aria-hidden="true">✓</span> Hasil tersimpan di akun Anda</p>
                  <div className="app-history-detail__delete-utility">
                    <button className="app-text-action app-text-action--danger" type="button" onClick={() => setDeleteTargets([selected])} disabled={isDeleting}>
                      {isDeleting ? 'Menghapus…' : 'Hapus hasil'}
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        <Link className="app-history-page__back" to="/account"><BackArrowIcon /> Pengaturan akun</Link>
      </main>
      {deleteTargets.length > 0 && (
        <div className="app-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isDeleting) setDeleteTargets([])
        }}>
          <section ref={deleteDialogRef} className="app-dialog app-dialog--danger" role="alertdialog" aria-modal="true" aria-busy={isDeleting} aria-labelledby="delete-history-title" aria-describedby="delete-history-description">
            <p className="app-kicker">Hapus data tersimpan</p>
            <h2 id="delete-history-title">{deleteTargets.length === 1 ? 'Hapus hasil skrining ini?' : `Hapus ${deleteTargets.length} hasil skrining?`}</h2>
            <p id="delete-history-description">Tindakan ini permanen dan tidak dapat dibatalkan.</p>
            {deleteTargets.length === 1 ? (
              <div className="app-dialog__context" aria-label="Hasil yang akan dihapus">
                <strong>{deleteTargets[0].top_prediction_label}</strong>
                <span>{formatDate(deleteTargets[0].created_at)}</span>
              </div>
            ) : <p className="app-dialog__selection-summary">Semua hasil yang dipilih, termasuk percakapan dan foto privat terkait, akan dihapus.</p>}
            <p className="app-dialog__impact-label">Yang akan dihapus dari akun:</p>
            <ul className="app-dialog__impact">
              <li>{deleteTargets.length === 1 ? 'Hasil skrining dan ringkasannya' : `${deleteTargets.length} hasil skrining dan ringkasannya`}</li>
              {deleteTargets.some((record) => record.photo_path) && <li>Foto fundus privat yang terkait</li>}
              <li>Percakapan yang terkait dengan hasil tersebut</li>
            </ul>
            <div className="app-dialog__actions app-dialog__actions--danger">
              <button ref={cancelDeleteRef} className="app-secondary-action" type="button" onClick={() => setDeleteTargets([])} disabled={isDeleting}>Batal</button>
              <button className="app-danger-action" type="button" onClick={() => { void confirmDelete() }} disabled={isDeleting}>
                {isDeleting ? 'Menghapus…' : 'Hapus permanen'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
