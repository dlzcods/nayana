import { useState } from 'react'
import { downloadScreeningPdf, type ExecutiveSummary, type ScreeningResult } from '../lib/screening-api'
import { discussionQuestionsFor } from '../lib/discussion-questions'

type ScreeningPdfActionProps = {
  screening: ScreeningResult
  summary: ExecutiveSummary | null
  className?: string
  imageUrl?: string | null
  discussionQuestions?: string[]
  doctorKitHref?: string
}

const maxPdfAttachmentBytes = 10 * 1024 * 1024

export function ScreeningPdfAction({
  screening,
  summary,
  className,
  imageUrl,
  discussionQuestions = [],
  doctorKitHref,
}: ScreeningPdfActionProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [includeImage, setIncludeImage] = useState(false)
  const [includeQuestions, setIncludeQuestions] = useState(false)

  async function download() {
    setState('loading')
    setError(null)
    try {
      let fundusImage: Blob | undefined
      if (includeImage && imageUrl) {
        const imageResponse = await fetch(imageUrl)
        if (!imageResponse.ok) throw new Error('Foto fundus belum dapat dimuat untuk PDF.')
        const imageBlob = await imageResponse.blob()
        if (imageBlob.size > maxPdfAttachmentBytes) throw new Error('Foto fundus melebihi batas 10 MB untuk lampiran PDF.')
        fundusImage = imageBlob
      }
      const selectedDiscussionQuestions = includeQuestions
        ? discussionQuestions.length > 0
          ? discussionQuestionsFor(screening).filter((item) => discussionQuestions.includes(item.question))
          : discussionQuestionsFor(screening)
        : []
      const blob = await downloadScreeningPdf({ screening, summary, fundusImage, discussionQuestions: selectedDiscussionQuestions })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'nayana-ringkasan-skrining.pdf'
      anchor.click()
      URL.revokeObjectURL(url)
      setIsOpen(false)
    } catch (reason) {
      setState('error')
      setError(reason instanceof Error ? reason.message : 'PDF belum dapat dibuat.')
    } finally {
      setState('idle')
    }
  }

  const questionCopy = discussionQuestions.length > 0
    ? `${discussionQuestions.length} pertanyaan yang Anda pilih akan disertakan.`
    : 'Tiga pertanyaan rekomendasi akan disertakan.'

  return (
    <div className={['screening-pdf', className].filter(Boolean).join(' ')}>
      <button className="app-secondary-action" type="button" onClick={() => { setError(null); setIsOpen(true) }}>
        Siapkan PDF
      </button>
      {isOpen && (
        <div className="export-sheet-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && state !== 'loading') setIsOpen(false)
        }}>
          <section className="export-sheet" role="dialog" aria-modal="true" aria-labelledby={`export-title-${screening.screening_id}`}>
            <button className="export-sheet__close" type="button" onClick={() => setIsOpen(false)} disabled={state === 'loading'} aria-label="Tutup">×</button>
            <p className="export-sheet__handle" aria-hidden="true" />
            <p className="app-kicker">Ekspor PDF</p>
            <h2 id={`export-title-${screening.screening_id}`}>Pilih isi ringkasan</h2>
            <p>Hasil skrining dan batasannya selalu disertakan.</p>
            <div className="export-sheet__items">
              <label>
                <input type="checkbox" checked disabled />
                <span><strong>Hasil skrining dan batasannya</strong><small>Indikasi model, kemiripan pola, dan penjelasan umum.</small></span>
              </label>
              <label>
                <input type="checkbox" checked={includeQuestions} onChange={(event) => setIncludeQuestions(event.target.checked)} disabled={state === 'loading'} />
                <span><strong>Sertakan pertanyaan untuk dokter</strong><small>{questionCopy}</small></span>
              </label>
              {imageUrl && (
                <label>
                  <input type="checkbox" checked={includeImage} onChange={(event) => setIncludeImage(event.target.checked)} disabled={state === 'loading'} />
                  <span><strong>Sertakan foto fundus</strong><small>Foto hanya dipakai sebagai lampiran pada PDF yang Anda unduh.</small></span>
                </label>
              )}
            </div>
            {doctorKitHref && <a className="app-text-action export-sheet__doctor-kit" href={doctorKitHref}>Atur pertanyaan di Doctor Kit</a>}
            {error && <p className="export-sheet__error" role="alert">{error}</p>}
            <button className="app-primary-action" type="button" disabled={state === 'loading'} onClick={() => { void download() }}>
              {state === 'loading' ? 'Menyiapkan PDF…' : 'Unduh PDF'}
            </button>
          </section>
        </div>
      )}
    </div>
  )
}
