import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { SiteHeader } from '../components/SiteHeader'
import { BackArrowIcon } from '../components/BackArrowIcon'
import {
  askScreeningQuestion,
  demoCaseIdFromScreeningId,
  demoCaseImageUrl,
  getExecutiveSummary,
  getScreeningResult,
  getSuggestedQuestions,
  type ExecutiveSummary,
  type ScreeningChatMessage,
  type ScreeningResult,
  type SuggestedQuestion,
} from '../lib/screening-api'
import { getActiveScreening, saveActiveScreening, setActiveScreeningChatAccess, getSessionChat, saveSessionChat } from '../lib/screening-session'
import { SuggestedQuestionStarter } from '../components/SuggestedQuestionStarter'
import { ChatSources } from '../components/ChatSources'
import type { ChatCitation } from '../lib/screening-api'

function renderInlineMarkdown(text: string, renderCitation: (text: string) => ReactNode): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{renderCitation(part.slice(2, -2))}</strong>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{renderCitation(part.slice(1, -1))}</em>
    return <Fragment key={index}>{renderCitation(part)}</Fragment>
  })
}

export function ChatMessageContent({ text, citations }: { text: string; citations?: ChatCitation[] }) {
  const blocks: Array<{ kind: 'paragraph' | 'list'; lines: string[] }> = []
  let paragraph: string[] = []
  let list: string[] = []

  function flushParagraph() {
    if (paragraph.length) blocks.push({ kind: 'paragraph', lines: [paragraph.join(' ')] })
    paragraph = []
  }

  function flushList() {
    if (list.length) blocks.push({ kind: 'list', lines: list })
    list = []
  }

  for (const sourceLine of text.replace(/^#{1,6}\s*/gm, '').split('\n')) {
    const line = sourceLine.trim()
    if (!line) {
      flushParagraph()
      flushList()
      continue
    }
    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/)
    if (bullet) {
      flushParagraph()
      list.push(bullet[1])
    } else {
      flushList()
      paragraph.push(line)
    }
  }
  flushParagraph()
  flushList()

  return (
    <ChatSources text={text} citations={citations} renderText={(_text, renderCitation) => <>
      {blocks.map((block, index) => block.kind === 'list' ? (
        <ul key={index}>{block.lines.map((line, lineIndex) => <li key={lineIndex}>{renderInlineMarkdown(line, renderCitation)}</li>)}</ul>
      ) : <p key={index}>{renderInlineMarkdown(block.lines[0], renderCitation)}</p>)}
    </>} />
  )
}

export function ScreeningChatPage() {
  const { screeningId } = useParams({ from: '/screening/results/$screeningId/chat' })
  const [screening, setScreening] = useState<ScreeningResult | null>(null)
  const [summary, setSummary] = useState<ExecutiveSummary | null>(null)
  const [messages, setMessages] = useState<ScreeningChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [isLoadingContext, setIsLoadingContext] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [temporaryAccessApproved, setTemporaryAccessApproved] = useState(() => getActiveScreening(screeningId)?.chatAccess === 'temporary')
  const initialQuestionSent = useRef(false)
  const roomEpoch = useRef(0)
  const sending = useRef(false)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const shouldFollowMessages = useRef(false)
  const requestedQuestion = new URLSearchParams(window.location.search).get('question')?.trim() || ''

  useEffect(() => {
    let active = true
    roomEpoch.current += 1
    sending.current = false
    setIsSending(false)
    setScreening(null)
    setSummary(null)
    setDraft('')
    setIsLoadingContext(true)
    setError(null)
    setMessages(getSessionChat(screeningId))
    initialQuestionSent.current = false
    setTemporaryAccessApproved(getActiveScreening(screeningId)?.chatAccess === 'temporary')

    void (async () => {
      const existing = getActiveScreening(screeningId)
      if (existing) {
        if (active) {
          setScreening(existing.screening)
          setSummary(existing.summary)
          setIsLoadingContext(false)
        }
        return
      }

      if (!screeningId.startsWith('demo_')) {
        if (active) {
          setError('Hasil sesi ini sudah tidak tersedia. Jalankan skrining kembali untuk memulai percakapan.')
          setIsLoadingContext(false)
        }
        return
      }

      try {
        const result = await getScreeningResult(screeningId)
        let nextSummary: ExecutiveSummary | null = null
        try {
          nextSummary = await getExecutiveSummary(result)
        } catch {
          nextSummary = null
        }
        if (active) {
          setScreening(result)
          setSummary(nextSummary)
          saveActiveScreening({ screening: result, summary: nextSummary })
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Ruang percakapan belum dapat dibuka.')
      } finally {
        if (active) setIsLoadingContext(false)
      }
    })()

    return () => { active = false; roomEpoch.current += 1 }
  }, [screeningId])

  async function sendQuestion(question: string, cachedAnswer?: SuggestedQuestion) {
    const cleanQuestion = question.trim()
    if (!cleanQuestion || !screening || sending.current) return
    sending.current = true
    const epoch = roomEpoch.current
    const nextMessages = [...messages, { role: 'user' as const, content: cleanQuestion }]
    setMessages(nextMessages)
    saveSessionChat(screeningId, nextMessages)
    setDraft('')
    setError(null)
    setIsSending(true)
    shouldFollowMessages.current = true
    try {
      if (cachedAnswer) {
        const completed: ScreeningChatMessage[] = [...nextMessages, { ...cachedAnswer, role: 'assistant', content: cachedAnswer.answer.trim() }]
        setMessages(completed)
        if (!saveSessionChat(screeningId, completed)) setError('Jawaban tampil, tetapi browser belum dapat menyimpan sesi ini untuk dimuat ulang.')
      } else {
        const response = await askScreeningQuestion({ screening, summary, messages: nextMessages })
        if (epoch !== roomEpoch.current) return
        const completed: ScreeningChatMessage[] = [...nextMessages, { ...response, role: 'assistant', content: response.answer.trim() }]
        setMessages(completed)
        if (!saveSessionChat(screeningId, completed)) setError('Jawaban tampil, tetapi browser belum dapat menyimpan sesi ini untuk dimuat ulang.')
      }
    } catch (reason) {
      if (epoch === roomEpoch.current) setError(reason instanceof Error ? reason.message : 'Jawaban belum dapat dibuat.')
    } finally {
      if (epoch === roomEpoch.current) { sending.current = false; setIsSending(false) }
    }
  }

  useEffect(() => {
    if (isLoadingContext || !screening || !temporaryAccessApproved || !requestedQuestion || initialQuestionSent.current) return
    initialQuestionSent.current = true
    if (getSessionChat(screeningId).some((message) => message.role === 'user' && message.content.trim() === requestedQuestion)) {
      window.history.replaceState({}, document.title, window.location.pathname)
      return
    }
    const epoch = roomEpoch.current
    void getSuggestedQuestions({ screening, summary })
      .then((questions) => { if (epoch === roomEpoch.current) return sendQuestion(requestedQuestion, questions.find((item) => item.question === requestedQuestion)) })
      .catch(() => { if (epoch === roomEpoch.current) return sendQuestion(requestedQuestion) })
      .finally(() => { if (epoch === roomEpoch.current) window.history.replaceState({}, document.title, window.location.pathname) })
  // The requested suggestion must only be submitted once per route open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screening, temporaryAccessApproved, isLoadingContext, requestedQuestion])

  useEffect(() => {
    if (!shouldFollowMessages.current || !messagesRef.current) return
    messagesRef.current.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, isSending])

  function continueWithoutSaving() {
    setActiveScreeningChatAccess(screeningId, 'temporary')
    setTemporaryAccessApproved(true)
  }

  const backPath = screeningId.startsWith('demo_')
    ? `/screening/results/${encodeURIComponent(screeningId)}`
    : '/screening'
  const imageUrl = screening?.case_id
    ? demoCaseImageUrl(screening.case_id)
    : demoCaseImageUrl(demoCaseIdFromScreeningId(screeningId) || '')

  return (
    <div className="app-page app-page--chat">
      <SiteHeader />
      <main className="app-history-chat app-history-chat--temporary" aria-busy={isLoadingContext}>
        <aside className="app-history-chat__context">
          <a className="app-chat-room__back" href={backPath}><BackArrowIcon /> Kembali ke hasil</a>
          {screening && (
            <div className="app-history-chat__mobile-heading">
              <p className="app-kicker">Ruang percakapan</p>
              <h2>Tanyakan hasil ini dengan tenang.</h2>
              <p>Jawaban bersifat edukatif dan membantu Anda menyiapkan diskusi dengan dokter spesialis mata (Sp.M).</p>
            </div>
          )}
          {screening && (
            <>
              <div className="app-history-chat__result">
                {imageUrl ? <img src={imageUrl} alt="Fundus dari hasil skrining terpilih" /> : <span aria-hidden="true" />}
                <div>
                  <p className="app-kicker">Hasil skrining awal</p>
                  <h1>{screening.top_prediction.label}</h1>
                  <strong>{Math.round(screening.top_prediction.score * 100)}% kemiripan pola</strong>
                </div>
              </div>
              <p className="app-history-chat__note">Percakapan sementara ini tidak menyimpan foto atau pesan ke riwayat akun.</p>
            </>
          )}
        </aside>

        <section className="app-history-chat__thread" aria-labelledby="chat-title">
          {isLoadingContext && <div className="app-history-chat__loading" aria-live="polite">Membuka ruang percakapan…</div>}
          {error && !screening && (
            <div className="app-history-chat__empty" role="alert">
              <p className="app-kicker">Ruang percakapan</p>
              <h2>Hasil belum tersedia.</h2>
              <p>{error}</p>
              <Link className="app-primary-action" to="/screening">Mulai skrining</Link>
            </div>
          )}

          {screening && temporaryAccessApproved && (
            <>
              <header>
                <p className="app-kicker">Ruang percakapan</p>
                <h2 id="chat-title">Tanyakan hasil ini dengan tenang.</h2>
                <p>Jawaban bersifat edukatif dan membantu Anda menyiapkan diskusi dengan dokter spesialis mata (Sp.M).</p>
              </header>
              {messages.length === 0 && !isSending && (
                <SuggestedQuestionStarter screening={screening} summary={summary} onSelect={(item: SuggestedQuestion) => { void sendQuestion(item.question, item) }} />
              )}
              <div
                className="app-history-chat__messages"
                aria-live="polite"
                ref={messagesRef}
                onScroll={(event) => {
                  const element = event.currentTarget
                  shouldFollowMessages.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40
                }}
              >
                {messages.map((message, index) => <div className={`app-chat-bubble app-chat-bubble--${message.role}`} key={`${message.role}-${index}`}><ChatMessageContent text={message.content} citations={message.citations} /></div>)}
                {isSending && <div className="app-chat-bubble app-chat-bubble--loading" aria-label="Menyiapkan penjelasan"><span /><span /><span /><p>Menyusun penjelasan…</p></div>}
              </div>
              {error && <p className="app-chat-thread__error" role="alert">{error}</p>}
              <form className="app-history-chat__compose" onSubmit={(event) => { event.preventDefault(); void sendQuestion(draft) }}>
                <label className="sr-only" htmlFor="chat-room-input">Tulis pertanyaan tentang hasil ini</label>
                <input id="chat-room-input" value={draft} maxLength={900} placeholder="Tulis pertanyaan tentang hasil ini" onChange={(event) => setDraft(event.target.value)} disabled={isSending} />
                <button type="submit" aria-label="Kirim pertanyaan" disabled={isSending || !draft.trim()}>↗</button>
              </form>
            </>
          )}

          {screening && !temporaryAccessApproved && (
          <div className="app-dialog-backdrop" role="presentation">
            <section className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="temporary-chat-title">
              <p className="app-kicker">Sebelum berdiskusi</p>
              <h2 id="temporary-chat-title">Hasil ini belum disimpan.</h2>
              <p>
                Jika Anda lanjut, percakapan hanya tersedia selama sesi browser ini. Foto dan percakapan tidak akan muncul di riwayat akun.
              </p>
              <div className="app-dialog__actions">
                <a className="app-primary-action" href={backPath}>Kembali untuk menyimpan</a>
                <button className="app-text-action" type="button" onClick={continueWithoutSaving}>Lanjut tanpa menyimpan</button>
              </div>
            </section>
          </div>
        )}
        </section>
      </main>
    </div>
  )
}
