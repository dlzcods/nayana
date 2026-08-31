import { useEffect, useState } from 'react'

const finalizingSteps = [
  'Mulai mempelajari pola',
  'Merangkum kemiripan pola',
  'Menyusun ringkasan edukatif',
  'Menata langkah berikutnya',
]

type ScreeningFinalizingProps = {
  source: 'demo' | 'upload'
  imageUrl?: string
}

export function ScreeningFinalizing({ source, imageUrl }: ScreeningFinalizingProps) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStep((current) => (current + 1) % finalizingSteps.length)
    }, 2200)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <section className="app-finalizing" aria-live="polite" aria-label="Menyiapkan hasil skrining">
      <div className="app-finalizing__visual" aria-hidden="true">
        <span className="app-finalizing__corner app-finalizing__corner--top-left" />
        <span className="app-finalizing__corner app-finalizing__corner--top-right" />
        <span className="app-finalizing__corner app-finalizing__corner--bottom-left" />
        <span className="app-finalizing__corner app-finalizing__corner--bottom-right" />
        {imageUrl ? (
          <span className="app-finalizing__image">
            <img src={imageUrl} alt="" />
          </span>
        ) : (
          <span className="app-finalizing__placeholder" />
        )}
        <span className="app-finalizing__scan" />
      </div>

      <div className="app-finalizing__dots" aria-hidden="true">
        <span className={step % 3 === 0 ? 'is-active' : ''} />
        <span className={step % 3 === 1 ? 'is-active' : ''} />
        <span className={step % 3 === 2 ? 'is-active' : ''} />
      </div>

      <p className="app-kicker">Skrining awal NAYANA</p>
      <h2>{finalizingSteps[step]}</h2>
      <p className="app-finalizing__support">
        {source === 'demo'
          ? 'Hasil contoh akan ditampilkan bersama setelah siap.'
          : 'Hasil Anda akan ditampilkan bersama setelah siap.'}
      </p>
    </section>
  )
}
