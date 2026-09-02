import type { ReactNode } from 'react'

type ResultPathwayProps = {
  action: ReactNode
}

const steps = [
  'Skrining awal NAYANA',
  'Ringkasan hasil',
  'Konsultasi Sp.M',
  'Validasi klinis',
  'Penanganan bila diperlukan',
]

export function ResultPathway({ action }: ResultPathwayProps) {
  return (
    <section className="result-pathway" aria-labelledby="result-pathway-title">
      <div>
        <p className="app-kicker">Langkah berikutnya</p>
        <h2 id="result-pathway-title">Dari skrining awal ke pemeriksaan yang tepat.</h2>
        <p>NAYANA membantu mempercepat tahap skrining awal. Dokter spesialis mata (Sp.M) memastikan diagnosis dan penanganannya.</p>
      </div>
      <ol>
        {steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}
      </ol>
      <div className="result-pathway__action">{action}</div>
    </section>
  )
}
