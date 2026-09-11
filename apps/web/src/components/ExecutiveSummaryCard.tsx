import { type ExecutiveSummary, type ScreeningResult } from '../lib/screening-api'

type ExecutiveSummaryCardProps = {
  screening: ScreeningResult
  summary: ExecutiveSummary | null
  error?: string | null
}

export function ExecutiveSummaryCard({ screening, summary, error }: ExecutiveSummaryCardProps) {
  return (
    <section className="executive-summary" aria-live="polite" aria-labelledby={`summary-${screening.screening_id}`}>
      <div className="executive-summary__head">
        <p className="app-kicker">Ringkasan otomatis</p>
        <h2 id={`summary-${screening.screening_id}`}>Yang perlu Anda pahami sekarang.</h2>
      </div>

      {error && (
        <p className="executive-summary__unavailable">
          {error} Hasil persentase di atas tetap dapat digunakan sebagai bahan diskusi dengan dokter spesialis mata (Sp.M).
        </p>
      )}

      {summary && (
        <div className="executive-summary__body">
          <article className="executive-summary__overview">
            <p className="executive-summary__label">Apa artinya</p>
            <h3>{summary.title}</h3>
            <p>{summary.overview}</p>
          </article>
          <aside className="executive-summary__next">
            <p className="executive-summary__label">Langkah yang disarankan</p>
            <p>{summary.next_step}</p>
          </aside>
          <div className="executive-summary__details">
            <details>
              <summary>Tentang pola ini</summary>
              <p>{summary.general_information}</p>
            </details>
            <details>
              <summary>Faktor umum</summary>
              <p>{summary.common_factors}</p>
            </details>
            <details>
              <summary>Hal yang dapat diperhatikan</summary>
              <p>{summary.what_to_notice}</p>
            </details>
          </div>
          <p className="executive-summary__disclaimer">{summary.disclaimer}</p>
        </div>
      )}
    </section>
  )
}
