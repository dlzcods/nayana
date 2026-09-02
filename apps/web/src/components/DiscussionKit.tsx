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
      <div>
        <p className="app-kicker">Siapkan diskusi dengan Sp.M</p>
        <h2 id={`discussion-kit-${screening.screening_id}`}>Bawa pertanyaan yang tepat.</h2>
        <p>Pilih pertanyaan yang ingin Anda sertakan dalam ringkasan PDF atau gunakan sebagai pembuka percakapan dengan dokter.</p>
      </div>
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
    </section>
  )
}
