import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { BackArrowIcon } from '../components/BackArrowIcon'
import { SiteHeader } from '../components/SiteHeader'
import { ChatMessageContent } from './ScreeningChatPage'
import { askScreeningQuestion, demoCaseIdFromScreeningId, demoCaseImageUrl, getSuggestedQuestions, type ScreeningChatMessage, type SuggestedQuestion } from '../lib/screening-api'
import { getConversationMessages, getOrCreateConversation, saveConversationMessage, type ScreeningConversation } from '../lib/screening-conversations'
import { getAccountHistoryRecord, getAccountPhoto, screeningFromHistory, type ScreeningHistoryItem } from '../lib/screening-history'
import { SuggestedQuestionStarter } from '../components/SuggestedQuestionStarter'

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
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const shouldFollowMessages = useRef(false)
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
    setMessages([])
    initialQuestionSent.current = false
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

  async function sendQuestion(question: string, cachedAnswer?: SuggestedQuestion) {
    const cleanQuestion = question.trim()
    if (!cleanQuestion || !record || !conversation || sending.current) return
    sending.current = true
    const epoch = roomEpoch.current
    const userMessage: ScreeningChatMessage = { role: 'user', content: cleanQuestion }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setDraft('')
    setError(null)
    setIsSending(true)
    shouldFollowMessages.current = true
    let didPersistUserMessage = false
    try {
      await saveConversationMessage(conversation.id, userMessage)
      didPersistUserMessage = true
      if (epoch !== roomEpoch.current) return
      const response = cachedAnswer || await askScreeningQuestion({
          screening: screeningFromHistory(record),
          summary: record.executive_summary,
          messages: nextMessages.slice(-10),
        })
      const assistantMessage: ScreeningChatMessage = { ...response, role: 'assistant', content: response.answer.trim() }
      await saveConversationMessage(conversation.id, assistantMessage)
      if (epoch !== roomEpoch.current) return
      setMessages((current) => [...current, assistantMessage])
    } catch (reason) {
      if (epoch !== roomEpoch.current) return
      if (!didPersistUserMessage) {
        setMessages((current) => current.filter((message, index) => !(index === current.length - 1 && message === userMessage)))
        setDraft(cleanQuestion)
      }
      const message = reason instanceof Error ? reason.message : 'Jawaban belum dapat dibuat.'
      setError(didPersistUserMessage ? `${message} Pertanyaan Anda tetap tersimpan.` : message)
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

  return (
    <div className="app-page app-page--chat">
      <SiteHeader />
      <main className="app-history-chat" aria-busy={isLoading}>
        <aside className="app-history-chat__context">
          <Link className="app-chat-room__back" to="/history" search={{ hasil: undefined }}><BackArrowIcon /> Kembali ke riwayat</Link>
          {record && (
            <>
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
              <header>
                <p className="app-kicker">Ruang percakapan</p>
                <h2 id="history-chat-title">Tanyakan hasil ini dengan tenang.</h2>
                <p>Jawaban bersifat edukatif untuk membantu Anda memahami hasil skrining awal dan menyiapkan diskusi lanjutan.</p>
              </header>
              {messages.length === 0 && !isSending && (
                <SuggestedQuestionStarter
                  screening={screeningFromHistory(record)}
                  summary={record.executive_summary}
                  onSelect={(item: SuggestedQuestion) => { void sendQuestion(item.question, item) }}
                />
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
                {messages.map((message, index) => (
                  <div className={`app-chat-bubble app-chat-bubble--${message.role}`} key={`${message.role}-${index}`}><ChatMessageContent text={message.content} citations={message.citations} /></div>
                ))}
                {isSending && <div className="app-chat-bubble app-chat-bubble--loading" aria-label="Menyiapkan penjelasan"><span /><span /><span /><p>Menyusun penjelasan…</p></div>}
              </div>
              {error && <p className="app-chat-thread__error" role="alert">{error}</p>}
              <form className="app-history-chat__compose" onSubmit={(event) => { event.preventDefault(); void sendQuestion(draft) }}>
                <label className="sr-only" htmlFor="history-chat-input">Tulis pertanyaan tentang hasil ini</label>
                <input id="history-chat-input" value={draft} maxLength={900} disabled={isSending} placeholder="Tulis pertanyaan tentang hasil ini" onChange={(event) => setDraft(event.target.value)} />
                <button type="submit" disabled={isSending || !draft.trim()} aria-label="Kirim pertanyaan">↗</button>
              </form>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
