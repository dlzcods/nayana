import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { getActiveScreening, saveActiveScreening, setActiveScreeningChatAccess } from '../lib/screening-session'
import { type ExecutiveSummary, type ScreeningResult } from '../lib/screening-api'
import { SuggestedQuestionStarter } from './SuggestedQuestionStarter'

type ScreeningChatProps = {
  screening: ScreeningResult
  summary: ExecutiveSummary | null
  savedDestination?: { kind: 'account'; recordId: string } | { kind: 'browser' } | null
}

export function ScreeningChat({ screening, summary, savedDestination = null }: ScreeningChatProps) {
  const navigate = useNavigate()
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)

  useEffect(() => {
    saveActiveScreening({
      screening,
      summary,
      chatAccess: getActiveScreening(screening.screening_id)?.chatAccess,
    })
  }, [screening, summary])

  function openChat(question?: string) {
    if (savedDestination?.kind === 'account') {
      void navigate({
        to: '/history/$recordId/chat',
        params: { recordId: savedDestination.recordId },
        search: question ? { question } : {},
      })
      return
    }
    if (!savedDestination) {
      setPendingQuestion(question || '')
      return
    }
    setActiveScreeningChatAccess(screening.screening_id, 'temporary')
    void navigate({
      to: '/screening/results/$screeningId/chat',
      params: { screeningId: screening.screening_id },
      search: question ? { question } : {},
    })
  }

  function continueWithoutSaving() {
    setActiveScreeningChatAccess(screening.screening_id, 'temporary')
    const question = pendingQuestion || undefined
    setPendingQuestion(null)
    void navigate({
      to: '/screening/results/$screeningId/chat',
      params: { screeningId: screening.screening_id },
      search: question ? { question } : {},
    })
  }

  function returnToSave() {
    setPendingQuestion(null)
    document.getElementById(`save-${screening.screening_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <section className="screening-chat" aria-labelledby={`chat-${screening.screening_id}`}>
      <div className="screening-chat__head">
        <div>
          <p className="app-kicker">Tanya tentang hasil</p>
          <h2 id={`chat-${screening.screening_id}`}>Butuh penjelasan lebih lanjut?</h2>
        </div>
        <p>Masuk ke ruang percakapan khusus untuk membahas hasil ini dengan konteks yang sama.</p>
      </div>

      <SuggestedQuestionStarter screening={screening} summary={summary} onSelect={(item) => openChat(item.question)} />
      <button className="screening-chat__open" type="button" onClick={() => openChat()}>
        Buka ruang percakapan
      </button>

      {pendingQuestion !== null && (
        <div className="app-dialog-backdrop" role="presentation">
          <section className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-save-title">
            <p className="app-kicker">Sebelum berdiskusi</p>
            <h3 id="chat-save-title">Simpan hasil ini terlebih dahulu?</h3>
            <p>
              Jika lanjut tanpa menyimpan, percakapan hanya tersedia pada sesi browser ini dan foto tidak masuk ke riwayat.
              Simpan hasil untuk menghubungkan foto privat, riwayat, dan percakapan sesuai masa simpan yang dipilih.
            </p>
            <div className="app-dialog__actions">
              <button className="app-primary-action" type="button" onClick={returnToSave}>Pilih penyimpanan</button>
              <button className="app-text-action" type="button" onClick={continueWithoutSaving}>Lanjut tanpa menyimpan</button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
