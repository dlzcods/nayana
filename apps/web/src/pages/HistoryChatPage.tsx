import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { BackArrowIcon } from '../components/BackArrowIcon'
import { SiteHeader } from '../components/SiteHeader'
import { ChatMessageContent } from './ScreeningChatPage'
import { compactConversationMemory, demoCaseIdFromScreeningId, demoCaseImageUrl, getSuggestedQuestions, streamScreeningQuestion, type ScreeningChatMessage, type SuggestedQuestion } from '../lib/screening-api'
import { getConversationMessages, getOrCreateConversation, saveConversationMessage, type ScreeningConversation } from '../lib/screening-conversations'
import { getAccountHistoryRecord, getAccountPhoto, screeningFromHistory, type ScreeningHistoryItem } from '../lib/screening-history'
import { SuggestedQuestionStarter } from '../components/SuggestedQuestionStarter'

type OverviewPreference = 'auto' | 'expanded' | 'collapsed'

function initialOverviewPreference(): OverviewPreference {
  return window.matchMedia('(max-width: 620px)').matches ? 'collapsed' : 'auto'
}

function percentage(value: number) {
  return `${Math.round(value * 100)}%`
}

export function HistoryChatPage() {
  const { recordId } = useParams({ from: '/history/$recordId/chat' })
  const [record, setRecord] = useState<ScreeningHistoryItem | null>(null)
  const [conversation, setConversation] = useState<ScreeningConversation | null>(null)
  const [messages, setMessages] = useState<ScreeningChatMessage[]>([])
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failedQuestion, setFailedQuestion] = useState<string | null>(null)
  const [overviewPreference, setOverviewPreference] = useState<OverviewPreference>(initialOverviewPreference)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const shouldFollowMessages = useRef(false)
  const initialMessagesPositioned = useRef(false)
  const initialQuestionSent = useRef(false)
  const roomEpoch = useRef(0)
  const sending = useRef(false)
  const requestedQuestion = new URLSearchParams(window.location.search).get('question')?.trim() || ''

  useEffect(() => {
    let active = true
    roomEpoch.current += 1
    sending.current = false
    setIsSending(false)
    setRecord(null)
    setConversation(null)
    setPhotoUrl(null)
    setDraft('')
    let objectUrl: string | null = null
    setIsLoading(true)
    setError(null)
    setFailedQuestion(null)
    setOverviewPreference(initialOverviewPreference())
    setMessages([])
    initialQuestionSent.current = false
    initialMessagesPositioned.current = false
    void (async () => {
      const nextRecord = await getAccountHistoryRecord(recordId)
      if (!nextRecord) throw new Error('Hasil ini tidak lagi tersedia di riwayat Anda.')
      const nextConversation = await getOrCreateConversation(recordId)
      const storedMessages = await getConversationMessages(nextConversation.id)
      const nextPhoto = await getAccountPhoto(nextRecord)
      if (!active) {
        if (nextPhoto) URL.revokeObjectURL(nextPhoto)
        return
      }
      objectUrl = nextPhoto
      setRecord(nextRecord)
      setConversation(nextConversation)
      setMessages(storedMessages.map(({ role, content, citations, source_status, corpus_version }) => ({ role, content, citations, source_status, corpus_version })))
      setPhotoUrl(nextPhoto)
    })().catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Ruang percakapan belum dapat dibuka.')
    }).finally(() => { if (active) setIsLoading(false) })
    return () => {
      active = false
      roomEpoch.current += 1
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [recordId])

  useEffect(() => {
    if (!shouldFollowMessages.current || !messagesRef.current) return
    messagesRef.current.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, isSending])

  // Position saved conversations at their newest message only on room open.
  // Subsequent manual scrolling is never overridden by this effect.
  useLayoutEffect(() => {
    if (initialMessagesPositioned.current || !messages.length || !messagesRef.current) return
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    initialMessagesPositioned.current = true
  }, [messages])

  async function sendQuestion(question: string, cachedAnswer?: SuggestedQuestion, retry = false) {
    const cleanQuestion = question.trim()
    if (!cleanQuestion || !record || !conversation || sending.current) return
    sending.current = true
    const epoch = roomEpoch.current
    const userMessage: ScreeningChatMessage = { role: 'user', content: cleanQuestion }
    const latestMessage = messages.at(-1)
    const isRetryingStoredQuestion = retry
      && latestMessage?.role === 'user'
      && latestMessage.content.trim() === cleanQuestion
    const nextMessages = isRetryingStoredQuestion ? messages : [...messages, userMessage]
    if (!isRetryingStoredQuestion) setMessages(nextMessages)
    setDraft('')
    setError(null)
    setFailedQuestion(null)
    setIsSending(true)
    shouldFollowMessages.current = true
    let didPersistUserMessage = isRetryingStoredQuestion
    try {
      if (!isRetryingStoredQuestion) {
        await saveConversationMessage(conversation.id, userMessage)
        didPersistUserMessage = true
      }
      if (epoch !== roomEpoch.current) return
      let response: Omit<ScreeningChatMessage, 'role' | 'content'> & { answer?: string }
      if (cachedAnswer?.answer) {
        response = { ...cachedAnswer, answer: cachedAnswer.answer.trim() }
      } else {
        let streamedContent = ''
        let streamedMetadata: Omit<ScreeningChatMessage, 'role' | 'content'> = {}
        const metadata = await streamScreeningQuestion({
          screening: screeningFromHistory(record),
          question: cleanQuestion,
          memory: compactConversationMemory(nextMessages.slice(0, -1)),
        }, {
          onStatus: () => undefined,
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
      }
      const answer = response.answer?.trim()
      if (!answer) throw new Error('Jawaban bersumber belum tersedia.')
      const assistantMessage: ScreeningChatMessage = { ...response, role: 'assistant', content: answer }
      await saveConversationMessage(conversation.id, assistantMessage)
      if (epoch !== roomEpoch.current) return
      // Sentence events have already rendered one temporary assistant bubble.
      // Final completion replaces that bubble with its complete metadata.
      setMessages([...nextMessages, assistantMessage])
      setFailedQuestion(null)
    } catch (reason) {
      if (epoch !== roomEpoch.current) return
      if (!didPersistUserMessage) {
        setMessages((current) => current.filter((message, index) => !(index === current.length - 1 && message === userMessage)))
        setDraft(cleanQuestion)
      }
      const message = reason instanceof Error ? reason.message : 'Jawaban belum dapat dibuat.'
      setError(didPersistUserMessage ? `${message} Pertanyaan Anda tetap tersimpan.` : message)
      setFailedQuestion(didPersistUserMessage ? cleanQuestion : null)
    } finally {
      if (epoch === roomEpoch.current) { sending.current = false; setIsSending(false) }
    }
  }

  useEffect(() => {
    if (isLoading || !record || !conversation || !requestedQuestion || initialQuestionSent.current) return
    initialQuestionSent.current = true
    if (messages.some((message) => message.role === 'user' && message.content.trim() === requestedQuestion)) {
      window.history.replaceState({}, document.title, window.location.pathname)
      return
    }
    const screening = screeningFromHistory(record)
    const epoch = roomEpoch.current
    void getSuggestedQuestions({ screening, summary: record.executive_summary })
      .then((questions) => { if (epoch === roomEpoch.current) return sendQuestion(requestedQuestion, questions.find((item) => item.question === requestedQuestion)) })
      .catch(() => { if (epoch === roomEpoch.current) return sendQuestion(requestedQuestion) })
      .finally(() => { if (epoch === roomEpoch.current) window.history.replaceState({}, document.title, window.location.pathname) })
  // A suggested question is intentionally sent once per opened room.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, conversation, isLoading, messages, requestedQuestion])

  const demoImageUrl = record?.source === 'demo'
    ? demoCaseImageUrl(demoCaseIdFromScreeningId(record.origin_screening_id || '') || '')
    : ''
  const resultImageUrl = photoUrl || demoImageUrl
  const overviewExpanded = overviewPreference === 'expanded'
    || (overviewPreference === 'auto' && messages.length === 0 && !isSending)
  const overviewToggleLabel = overviewExpanded ? 'Sembunyikan ringkasan' : 'Tampilkan ringkasan'
  const compactResultLabel = record
    ? `${record.top_prediction_label} · ${percentage(record.predictions.find((item) => item.key === record.top_prediction_key)?.score || 0)} kemiripan pola`
    : 'Ringkasan hasil'

  function toggleOverview() {
    setOverviewPreference(overviewExpanded ? 'collapsed' : 'expanded')
  }

  return (
    <div className="app-page app-page--chat">
      <SiteHeader />
      <main className="app-history-chat" aria-busy={isLoading}>
        <aside className={`app-history-chat__context ${overviewExpanded ? 'is-expanded' : 'is-collapsed'}`}>
          <Link className="app-chat-room__back" to="/history" search={{ hasil: undefined }}><BackArrowIcon /> Kembali ke riwayat</Link>
          {record && (
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
                  <p>Jawaban bersifat edukatif untuk membantu Anda memahami hasil skrining awal dan menyiapkan diskusi lanjutan.</p>
                </div>
                <div className="app-history-chat__result">
                  {resultImageUrl ? <img src={resultImageUrl} alt={photoUrl ? 'Foto fundus dari hasil skrining terpilih' : 'Foto fundus contoh yang dipilih'} /> : (
                    <div className="app-history-chat__photo-unavailable">Foto tidak tersedia</div>
                  )}
                  <div>
                    <p className="app-kicker">Hasil skrining awal</p>
                    <h1>{record.top_prediction_label}</h1>
                    <strong>{percentage(record.predictions.find((item) => item.key === record.top_prediction_key)?.score || 0)} kemiripan pola</strong>
                  </div>
                </div>
                <p className="app-history-chat__note">Percakapan ini tersimpan bersama hasil tersebut. Gunakan sebagai bahan diskusi dengan dokter spesialis mata (Sp.M).</p>
              </div>
            </>
          )}
        </aside>

        <section className="app-history-chat__thread" aria-labelledby="history-chat-title">
          {isLoading && <div className="app-history-chat__loading" aria-live="polite">Membuka percakapan…</div>}
          {error && !record && (
            <div className="app-history-chat__empty" role="alert">
              <p className="app-kicker">Ruang percakapan</p>
              <h2>Hasil belum tersedia.</h2>
              <p>{error}</p>
              <Link className="app-primary-action" to="/history" search={{ hasil: undefined }}>Kembali ke riwayat</Link>
            </div>
          )}
          {record && (
            <>
              <header className={`app-history-chat__thread-overview ${overviewExpanded ? 'is-expanded' : 'is-collapsed'}`}>
                <button type="button" className="app-history-chat__thread-toggle" aria-expanded={overviewExpanded} onClick={toggleOverview}>
                  <span className="app-kicker">Ruang percakapan</span>
                  <span>{overviewExpanded ? overviewToggleLabel : compactResultLabel}</span>
                  <span aria-hidden="true">{overviewExpanded ? '⌃' : '⌄'}</span>
                </button>
                <div className="app-history-chat__thread-overview-copy">
                  <h2 id="history-chat-title">Tanyakan hasil ini dengan tenang.</h2>
                  <p>Pilih hal yang ingin Anda pahami dari hasil skrining dan siapkan bahan diskusi dengan dokter mata.</p>
                </div>
              </header>
              <div
                className={`app-history-chat__messages ${messages.length || isSending ? 'is-active' : 'is-empty'}`}
                aria-live="polite"
                ref={messagesRef}
                onScroll={(event) => {
                  const element = event.currentTarget
                  shouldFollowMessages.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40
                }}
              >
                {messages.map((message, index) => (
                  <div className={`app-chat-bubble app-chat-bubble--${message.role}`} key={`${message.role}-${index}`}><ChatMessageContent text={message.content} citations={message.citations} onCitationOpen={() => setOverviewPreference('collapsed')} /></div>
                ))}
                {isSending && <div className="app-chat-bubble app-chat-bubble--loading" aria-label="Menyiapkan penjelasan"><span /><span /><span /><p>Menyusun penjelasan…</p></div>}
              </div>
              {messages.length === 0 && !isSending && (
                <SuggestedQuestionStarter
                  screening={screeningFromHistory(record)}
                  summary={record.executive_summary}
                  onSelect={(item: SuggestedQuestion) => { void sendQuestion(item.question, item) }}
                />
              )}
              {error && <div className="app-chat-thread__error" role="alert"><p>{error}</p>{failedQuestion && <button type="button" onClick={() => { void sendQuestion(failedQuestion, undefined, true) }}>Coba lagi</button>}</div>}
              <form className="app-history-chat__compose" onSubmit={(event) => { event.preventDefault(); void sendQuestion(draft) }}>
                <label className="sr-only" htmlFor="history-chat-input">Tulis pertanyaan tentang hasil ini</label>
                <input id="history-chat-input" value={draft} maxLength={900} disabled={isSending} placeholder="Tulis pertanyaan tentang hasil ini" onChange={(event) => setDraft(event.target.value)} />
                <button type="submit" disabled={isSending || !draft.trim()} aria-label="Kirim pertanyaan">↗</button>
                <p className="app-history-chat__disclaimer">NAYANA adalah skrining awal, bukan pengganti diagnosis dokter.</p>
              </form>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
