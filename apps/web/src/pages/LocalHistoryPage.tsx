import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { BackArrowIcon } from '../components/BackArrowIcon'
import { SiteHeader } from '../components/SiteHeader'
import { getGuestHistory, guestHistoryLifetime } from '../lib/screening-history'

function formatDate(value: number) {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function percentage(value: number) {
  return `${Math.round(value * 100)}%`
}

function remainingDays(storedAt: number) {
  return Math.max(1, Math.ceil((storedAt + guestHistoryLifetime - Date.now()) / (24 * 60 * 60 * 1000)))
}

export function LocalHistoryPage() {
  const history = useMemo(() => getGuestHistory(), [])
  const [selectedId, setSelectedId] = useState(history[0]?.result.screening_id || '')
  const selected = history.find((item) => item.result.screening_id === selectedId) || history[0] || null

  return (
    <div className="app-page app-local-history-page">
      <SiteHeader />
      <main className="app-shell app-local-history" aria-labelledby="local-history-title">
        <Link className="app-local-history__back" to="/screening"><BackArrowIcon /> Kembali ke skrining</Link>

        <section className="app-local-history__intro">
          <p className="app-kicker">Riwayat lokal</p>
          <h1 id="local-history-title">Hasil tersimpan di perangkat.</h1>
          <p>Data teks tersimpan di browser ini selama 3 hari. Foto fundus tidak disimpan.</p>
        </section>

        {history.length === 0 ? (
          <section className="app-local-history__empty">
            <p className="app-kicker">Belum ada hasil lokal</p>
            <h2>Hasil skrining yang Anda simpan akan tampil di sini.</h2>
            <Link className="app-primary-action" to="/screening">Mulai skrining</Link>
          </section>
        ) : (
          <div className="app-local-history__workspace">
            <section className="app-local-history__list" aria-label="Hasil tersimpan di perangkat">
              {history.map((item) => {
                const result = item.result
                const isSelected = result.screening_id === selected?.result.screening_id
                const score = result.top_prediction.score
                return (
                  <button
                    className={`app-local-history__row${isSelected ? ' is-selected' : ''}`}
                    type="button"
                    aria-pressed={isSelected}
                    key={result.screening_id}
                    onClick={() => setSelectedId(result.screening_id)}
                  >
                    <span>
                      <small>{formatDate(item.storedAt)} · {formatTime(item.storedAt)}</small>
                      <strong>{result.top_prediction.label} · {percentage(score)}</strong>
                      <em>Tersisa {remainingDays(item.storedAt)} hari</em>
                    </span>
                    <i aria-hidden="true">›</i>
                  </button>
                )
              })}
            </section>

            {selected && (
              <section className="app-local-history__detail" aria-live="polite">
                <p className="app-kicker">Ringkasan tersimpan</p>
                <h2>{selected.result.top_prediction.label}</h2>
                <p className="app-local-history__score">{percentage(selected.result.top_prediction.score)} <span>kemiripan pola</span></p>
                <p>{selected.summary?.general_information || selected.summary?.overview || 'Hasil ini perlu dipahami bersama keluhan, riwayat kesehatan, dan pemeriksaan langsung oleh dokter mata.'}</p>
                <p className="app-local-history__disclaimer">Bukan diagnosis medis. Konfirmasi dengan dokter mata.</p>
              </section>
            )}
          </div>
        )}

        <section className="app-local-history__account-note">
          <p>Ingin membuka hasil dari perangkat lain atau menyimpannya lebih lama?</p>
          <Link className="app-secondary-action" to="/login">Masuk untuk menyimpan permanen</Link>
        </section>
      </main>
    </div>
  )
}
