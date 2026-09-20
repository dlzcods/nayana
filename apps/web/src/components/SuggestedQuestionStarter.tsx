import { useEffect, useMemo, useState } from 'react'
import {
  getSuggestedQuestions,
  type ExecutiveSummary,
  type ScreeningResult,
  type SuggestedQuestion,
} from '../lib/screening-api'

const fallbackPrompts: Record<string, string[]> = {
  cataract: [
    'Apa yang dimaksud dengan katarak?',
    'Gejala katarak apa yang perlu diperhatikan?',
    'Bagaimana katarak biasanya ditangani?',
  ],
  diabetic_retinopathy: [
    'Apa yang dimaksud dengan retinopati diabetik?',
    'Tanda retinopati diabetik apa yang perlu diperhatikan?',
    'Mengapa diabetes dapat memengaruhi retina?',
  ],
  glaucoma: [
    'Apa yang dimaksud dengan glaukoma?',
    'Gejala glaukoma apa yang perlu diperhatikan?',
    'Pemeriksaan apa yang membantu menilai glaukoma?',
  ],
  normal: [
    'Apa arti kategori normal pada hasil ini?',
    'Kebiasaan apa yang dapat menjaga kesehatan mata?',
    'Kapan saya perlu memeriksakan mata ke dokter?',
  ],
}

function fallbackQuestions(screening: ScreeningResult): SuggestedQuestion[] {
  const prompts = fallbackPrompts[screening.top_prediction.key] || fallbackPrompts.normal
  return prompts.map((question, index) => ({
    id: `local-${screening.top_prediction.key}-${index}`,
    question,
  }))
}

type SuggestedQuestionStarterProps = {
  screening: ScreeningResult
  summary: ExecutiveSummary | null
  onSelect: (question: SuggestedQuestion) => void
}

export function SuggestedQuestionStarter({ screening, summary, onSelect }: SuggestedQuestionStarterProps) {
  const fallback = useMemo(() => fallbackQuestions(screening), [screening])
  const [questions, setQuestions] = useState<SuggestedQuestion[]>(fallback)
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const screeningKey = useMemo(
    () => `${screening.screening_id}:${screening.model_version}:${screening.predictions.map((item) => `${item.key}:${item.score.toFixed(3)}`).join('|')}`,
    [screening.model_version, screening.predictions, screening.screening_id],
  )

  useEffect(() => {
    let active = true
    setQuestions(fallback)
    setPage(0)
    setError(null)
    void getSuggestedQuestions({ screening, summary })
      .then((nextQuestions) => { if (active) setQuestions(nextQuestions) })
      .catch(() => {
        // Keep the local prompts visible. They lead to the same verified chat
        // flow and prevent an empty conversation when suggestions are offline.
        if (active) setError(null)
      })
    return () => { active = false }
  // Suggestions are based on the result fingerprint. A parent re-render or a
  // late summary object must not reset the visible question set.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallback, screeningKey])

  const visibleQuestions = useMemo(() => {
    if (!questions.length) return []
    const start = (page * 3) % questions.length
    return Array.from({ length: Math.min(3, questions.length) }, (_, index) => questions[(start + index) % questions.length])
  }, [page, questions])

  return (
    <div className="app-history-chat__starter" aria-live="polite">
      <div className="app-history-chat__starter-head">
        <p>Mulai dari salah satu pertanyaan ini, atau tulis pertanyaan Anda sendiri.</p>
        {questions.length > 3 && (
          <button className="app-history-chat__refresh" type="button" onClick={() => setPage((current) => current + 1)} aria-label="Tampilkan pertanyaan lain" title="Pertanyaan lain">
            <span aria-hidden="true">↻</span>
          </button>
        )}
      </div>
      {!questions.length && !error && <p className="app-history-chat__starter-status">Menyiapkan pertanyaan awal…</p>}
      {visibleQuestions.length > 0 && (
        <div>
          {visibleQuestions.map((item) => <button type="button" key={item.id} onClick={() => onSelect(item)}>{item.question}</button>)}
        </div>
      )}
    </div>
  )
}
