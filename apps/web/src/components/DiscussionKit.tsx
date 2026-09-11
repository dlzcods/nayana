import type { ScreeningResult } from '../lib/screening-api'
import { discussionQuestionsFor } from '../lib/discussion-questions'

type DiscussionKitProps = {
  screening: ScreeningResult
  selectedQuestions: string[]
  onChange: (questions: string[]) => void
}

export function DiscussionKit({ screening, selectedQuestions, onChange }: DiscussionKitProps) {
  const questions = discussionQuestionsFor(screening)

  function toggle(question: string) {
    onChange(selectedQuestions.includes(question)
      ? selectedQuestions.filter((item) => item !== question)
      : [...selectedQuestions, question])
  }

  return (
    <section className="discussion-kit" aria-labelledby={`discussion-kit-${screening.screening_id}`}>
      <details>
        <summary>
          <span>
            <span className="app-kicker">Persiapan konsultasi</span>
            <strong id={`discussion-kit-${screening.screening_id}`}>Siapkan pertanyaan untuk Sp.M</strong>
            <small>Pilih hanya pertanyaan yang ingin Anda bawa ke konsultasi atau masukkan ke PDF.</small>
          </span>
          <i aria-hidden="true">+</i>
        </summary>
        <div className="discussion-kit__questions">
          {questions.map((item, index) => (
            <label key={item.id}>
              <input type="checkbox" checked={selectedQuestions.includes(item.question)} onChange={() => toggle(item.question)} />
              <span className="discussion-kit__question-copy">
                <strong>Pertanyaan {index + 1}</strong>
                <span>{item.question}</span>
                <small><b>Tujuan:</b> {item.purpose}</small>
              </span>
            </label>
          ))}
        </div>
      </details>
    </section>
  )
}
