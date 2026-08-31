import { useEffect, useMemo, useState } from 'react'
import {
  getSuggestedQuestions,
  type ExecutiveSummary,
  type ScreeningResult,
  type SuggestedQuestion,
} from '../lib/screening-api'

type SuggestedQuestionStarterProps = {
  screening: ScreeningResult
  summary: ExecutiveSummary | null
  onSelect: (question: SuggestedQuestion) => void
}

export function SuggestedQuestionStarter({ screening, summary, onSelect }: SuggestedQuestionStarterProps) {
  const [questions, setQuestions] = useState<SuggestedQuestion[]>([])
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const screeningKey = useMemo(
    () => `${screening.screening_id}:${screening.model_version}:${screening.predictions.map((item) => `${item.key}:${item.score.toFixed(3)}`).join('|')}`,
    [screening.model_version, screening.predictions, screening.screening_id],
  )

  useEffect(() => {
    let active = true
    setQuestions([])
    setPage(0)
    setError(null)
    void getSuggestedQuestions({ screening, summary })
      .then((nextQuestions) => { if (active) setQuestions(nextQuestions) })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Pertanyaan lanjutan belum tersedia.')
      })
    return () => { active = false }
  // Suggestions are based on the result fingerprint. A parent re-render or a
  // late summary object must not reset the visible question set.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screeningKey])

  const visibleQuestions = useMemo(() => {
    if (!questions.length) return []
    const start = (page * 3) % questions.length
    return Array.from({ length: Math.min(3, questions.length) }, (_, index) => questions[(start + index) % questions.length])
  }, [page, questions])

  return (
    <div className="app-history-chat__starter" aria-live="polite">
      <div className="app-history-chat__starter-head">
        <p>Pilih sudut pembahasan, atau tulis pertanyaan Anda sendiri.</p>
        {questions.length > 3 && (
          <button className="app-history-chat__refresh" type="button" onClick={() => setPage((current) => current + 1)} aria-label="Tampilkan pertanyaan lain" title="Pertanyaan lain">
            <span aria-hidden="true">↻</span>
          </button>
        )}
      </div>
      {!questions.length && !error && <p className="app-history-chat__starter-status">Menyiapkan pertanyaan lanjutan…</p>}
      {error && <p className="app-history-chat__starter-status is-error">{error}</p>}
      {visibleQuestions.length > 0 && (
        <div>
          {visibleQuestions.map((item) => <button type="button" key={item.id} onClick={() => onSelect(item)}>{item.question}</button>)}
        </div>
      )}
    </div>
  )
}
