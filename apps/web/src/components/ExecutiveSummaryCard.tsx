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
        <h2 id={`summary-${screening.screening_id}`}>Ringkasan hasil Anda.</h2>
      </div>

      {error && (
        <p className="executive-summary__unavailable">
          {error} Hasil persentase di atas tetap dapat digunakan sebagai bahan diskusi dengan dokter spesialis mata (Sp.M).
        </p>
      )}

      {summary && (
        <div className="executive-summary__body">
          <div>
            <p className="executive-summary__label">Gambaran awal</p>
            <h3>{summary.title}</h3>
            <p>{summary.overview}</p>
          </div>
          <div className="executive-summary__notes">
            <div>
              <p className="executive-summary__label">Tentang pola ini</p>
              <p>{summary.general_information}</p>
            </div>
            <div>
              <p className="executive-summary__label">Faktor umum</p>
              <p>{summary.common_factors}</p>
            </div>
            <div>
              <p className="executive-summary__label">Yang dapat diperhatikan</p>
              <p>{summary.what_to_notice}</p>
            </div>
            <div>
              <p className="executive-summary__label">Langkah berikutnya</p>
              <p>{summary.next_step}</p>
            </div>
          </div>
          <p className="executive-summary__disclaimer">{summary.disclaimer}</p>
        </div>
      )}
    </section>
  )
}
