import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { SiteHeader } from '../components/SiteHeader'
import { BackArrowIcon } from '../components/BackArrowIcon'
import {
  demoCaseIdFromScreeningId,
  demoCaseImageUrl,
  getExecutiveSummary,
  getScreeningResult,
  getSuggestedQuestions,
  compactConversationMemory,
  streamScreeningQuestion,
  type ExecutiveSummary,
  type ScreeningChatMessage,
  type ScreeningChatStreamStatus,
  type ScreeningResult,
  type SuggestedQuestion,
} from '../lib/screening-api'
import { getActiveScreening, saveActiveScreening, getSessionChat, saveSessionChat } from '../lib/screening-session'
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

export function ChatMessageContent({ text, citations, onCitationOpen }: {
  text: string
  citations?: ChatCitation[]
  onCitationOpen?: () => void
}) {
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
    <ChatSources text={text} citations={citations} onCitationOpen={onCitationOpen} renderText={(_text, renderCitation) => <>
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
  const [streamStatus, setStreamStatus] = useState<ScreeningChatStreamStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [failedQuestion, setFailedQuestion] = useState<string | null>(null)
  const [overviewPreference, setOverviewPreference] = useState<'auto' | 'expanded' | 'collapsed'>('auto')
  const [temporaryAccessApproved, setTemporaryAccessApproved] = useState(() => getActiveScreening(screeningId)?.chatAccess === 'temporary')
  const initialQuestionSent = useRef(false)
  const roomEpoch = useRef(0)
  const sending = useRef(false)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const shouldFollowMessages = useRef(false)
  const initialMessagesPositioned = useRef(false)
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
    setFailedQuestion(null)
    setOverviewPreference('auto')
    setMessages(getSessionChat(screeningId))
    initialQuestionSent.current = false
    initialMessagesPositioned.current = false
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
        if (active) {
          setScreening(result)
          saveActiveScreening({ screening: result, summary: null })
          setIsLoadingContext(false)
        }
        void getExecutiveSummary(result).then((nextSummary) => {
          if (!active) return
          setSummary(nextSummary)
          saveActiveScreening({ ...getActiveScreening(screeningId), screening: result, summary: nextSummary })
        }).catch(() => undefined)
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Ruang percakapan belum dapat dibuka.')
      } finally {
        if (active) setIsLoadingContext(false)
      }
    })()

    return () => { active = false; roomEpoch.current += 1 }
  }, [screeningId])

  async function sendQuestion(question: string, cachedAnswer?: SuggestedQuestion, retry = false) {
    const cleanQuestion = question.trim()
    if (!cleanQuestion || !screening || sending.current) return
    sending.current = true
    const epoch = roomEpoch.current
    const latestMessage = messages.at(-1)
    const isRetryingStoredQuestion = retry
      && latestMessage?.role === 'user'
      && latestMessage.content.trim() === cleanQuestion
    const nextMessages = isRetryingStoredQuestion
      ? messages
      : [...messages, { role: 'user' as const, content: cleanQuestion }]
    if (!isRetryingStoredQuestion) {
      setMessages(nextMessages)
      saveSessionChat(screeningId, nextMessages)
    }
    setDraft('')
    setError(null)
    setFailedQuestion(null)
    setIsSending(true)
    setStreamStatus('retrieving')
    shouldFollowMessages.current = true
    try {
      if (cachedAnswer?.answer) {
        const completed: ScreeningChatMessage[] = [...nextMessages, { ...cachedAnswer, role: 'assistant', content: cachedAnswer.answer.trim() }]
        setMessages(completed)
        setFailedQuestion(null)
        if (!saveSessionChat(screeningId, completed)) setError('Jawaban tampil, tetapi browser belum dapat menyimpan sesi ini untuk dimuat ulang.')
      } else {
        const requestOptions = {
          screening,
          question: cleanQuestion,
          memory: compactConversationMemory(nextMessages.slice(0, -1)),
        }
        let response: Omit<ScreeningChatMessage, 'role' | 'content'> & { answer?: string }
        let streamedContent = ''
        let streamedMetadata: Omit<ScreeningChatMessage, 'role' | 'content'> = {}
        const metadata = await streamScreeningQuestion(requestOptions, {
          onStatus: (stage) => { if (epoch === roomEpoch.current) setStreamStatus(stage) },
          onSentence: (sentence) => {
            if (epoch !== roomEpoch.current) return
            streamedContent = [streamedContent, sentence.text.trim()].filter(Boolean).join(' ')
            streamedMetadata = {
              citations: sentence.citations,
              source_status: sentence.source_status,
              corpus_version: sentence.corpus_version,
            }
            setMessages([...nextMessages, { role: 'assistant', content: streamedContent, ...streamedMetadata }])
          },
        })
        if (!streamedContent) throw new Error('Sumber NEI belum cukup untuk menampilkan jawaban yang dapat diverifikasi.')
        response = { ...streamedMetadata, ...metadata, answer: streamedContent }
        if (epoch !== roomEpoch.current) return
        const completed: ScreeningChatMessage[] = [...nextMessages, {
          ...response,
          role: 'assistant',
          content: response.answer?.trim() || '',
        }]
        setMessages(completed)
        setFailedQuestion(null)
        if (!saveSessionChat(screeningId, completed)) setError('Jawaban tampil, tetapi browser belum dapat menyimpan sesi ini untuk dimuat ulang.')
      }
    } catch (reason) {
      if (epoch === roomEpoch.current) {
        setError(reason instanceof Error ? reason.message : 'Jawaban belum dapat dibuat.')
        setFailedQuestion(cleanQuestion)
      }
    } finally {
      if (epoch === roomEpoch.current) { sending.current = false; setIsSending(false); setStreamStatus(null) }
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

  // A short chat belongs just above the composer; an existing long chat should
  // open on its newest message. This is intentionally a one-time positioning
  // step, so it never pulls someone away while they read older messages.
  useLayoutEffect(() => {
    if (initialMessagesPositioned.current || !messages.length || !messagesRef.current) return
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    initialMessagesPositioned.current = true
  }, [messages])

  const backPath = screeningId.startsWith('demo_')
    ? `/screening/results/${encodeURIComponent(screeningId)}`
    : '/screening'
  const imageUrl = screening?.case_id
    ? demoCaseImageUrl(screening.case_id)
    : demoCaseImageUrl(demoCaseIdFromScreeningId(screeningId) || '')
  const overviewExpanded = overviewPreference === 'expanded'
    || (overviewPreference === 'auto' && messages.length === 0 && !isSending)
  const overviewToggleLabel = overviewExpanded ? 'Sembunyikan ringkasan' : 'Tampilkan ringkasan'
  const compactResultLabel = screening
    ? `${screening.top_prediction.label} · ${Math.round(screening.top_prediction.score * 100)}% kemiripan pola`
    : 'Ringkasan hasil'

  function toggleOverview() {
    setOverviewPreference(overviewExpanded ? 'collapsed' : 'expanded')
  }

  return (
    <div className="app-page app-page--chat">
      <SiteHeader />
      <main className="app-history-chat app-history-chat--temporary" aria-busy={isLoadingContext}>
        <aside className={`app-history-chat__context ${overviewExpanded ? 'is-expanded' : 'is-collapsed'}`}>
          <a className="app-chat-room__back" href={backPath}><BackArrowIcon /> Kembali ke hasil</a>
          {screening && (
            <>
              <button type="button" className="app-history-chat__overview-toggle" aria-expanded={overviewExpanded}
                onClick={toggleOverview}>
                <span><small>Ruang percakapan</small><strong>{compactResultLabel}</strong></span>
                <span aria-hidden="true">{overviewExpanded ? '⌃' : '⌄'}</span>
              </button>
              <div className="app-history-chat__mobile-overview">
                <div className="app-history-chat__mobile-heading">
                  <p className="app-kicker">Ruang percakapan</p>
                  <h2>Tanyakan hasil ini dengan tenang.</h2>
                  <p>Jawaban bersifat edukatif dan membantu Anda menyiapkan diskusi dengan dokter spesialis mata (Sp.M).</p>
                </div>
              <div className="app-history-chat__result">
                {imageUrl ? <img src={imageUrl} alt="Fundus dari hasil skrining terpilih" /> : <span aria-hidden="true" />}
                <div>
                  <p className="app-kicker">Hasil skrining awal</p>
                  <h1>{screening.top_prediction.label}</h1>
                  <strong>{Math.round(screening.top_prediction.score * 100)}% kemiripan pola</strong>
                </div>
              </div>
              <p className="app-history-chat__note">Percakapan sementara ini tidak menyimpan foto atau pesan ke riwayat akun.</p>
              </div>
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
              <header className={`app-history-chat__thread-overview ${overviewExpanded ? 'is-expanded' : 'is-collapsed'}`}>
                <button type="button" className="app-history-chat__thread-toggle" aria-expanded={overviewExpanded} onClick={toggleOverview}>
                  <span className="app-kicker">Ruang percakapan</span>
                  <span>{overviewExpanded ? overviewToggleLabel : compactResultLabel}</span>
                  <span aria-hidden="true">{overviewExpanded ? '⌃' : '⌄'}</span>
                </button>
                <div className="app-history-chat__thread-overview-copy">
                  <h2 id="chat-title">Tanyakan hasil ini dengan tenang.</h2>
                  <p>Pilih hal yang ingin Anda pahami dari hasil skrining dan siapkan bahan diskusi dengan dokter mata.</p>
                </div>
              </header>
              <div
                className="app-history-chat__messages"
                aria-live="polite"
                ref={messagesRef}
                onScroll={(event) => {
                  const element = event.currentTarget
                  shouldFollowMessages.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40
                }}
              >
                {messages.map((message, index) => <div className={`app-chat-bubble app-chat-bubble--${message.role}`} key={`${message.role}-${index}`}><ChatMessageContent text={message.content} citations={message.citations} onCitationOpen={() => setOverviewPreference('collapsed')} /></div>)}
                {isSending && <div className="app-chat-bubble app-chat-bubble--loading" aria-label="Menyiapkan penjelasan"><span /><span /><span /><p>{streamStatus === 'retrieving' ? 'Menyiapkan sumber…' : streamStatus === 'attributing' ? 'Memeriksa dukungan sumber…' : 'Menyusun penjelasan…'}</p></div>}
              </div>
              {messages.length === 0 && !isSending && (
                <SuggestedQuestionStarter screening={screening} summary={summary} onSelect={(item: SuggestedQuestion) => { void sendQuestion(item.question, item) }} />
              )}
              {error && <div className="app-chat-thread__error" role="alert"><p>{error}</p>{failedQuestion && <button type="button" onClick={() => { void sendQuestion(failedQuestion, undefined, true) }}>Coba lagi</button>}</div>}
              <form className="app-history-chat__compose" onSubmit={(event) => { event.preventDefault(); void sendQuestion(draft) }}>
                <label className="sr-only" htmlFor="chat-room-input">Tulis pertanyaan tentang hasil ini</label>
                <input id="chat-room-input" value={draft} maxLength={900} placeholder="Tulis pertanyaan tentang hasil ini" onChange={(event) => setDraft(event.target.value)} disabled={isSending} />
                <button type="submit" aria-label="Kirim pertanyaan" disabled={isSending || !draft.trim()}>↗</button>
                <p className="app-history-chat__disclaimer">NAYANA adalah skrining awal, bukan pengganti diagnosis dokter.</p>
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
              </div>
            </section>
          </div>
        )}
        </section>
      </main>
    </div>
  )
}
