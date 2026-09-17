import type { DiscussionQuestion } from './discussion-questions'

export type DemoCase = {
  id: string
  title: string
  description: string
  image_url: string
}

const DEMO_CASES: DemoCase[] = [
  {
    id: 'fundus-01',
    title: 'Contoh fundus 01',
    description: 'Pilih untuk melihat alur skrining awal NAYANA.',
    image_url: '/assets/demo-fundus/fundus-01.png',
  },
  {
    id: 'fundus-02',
    title: 'Contoh fundus 02',
    description: 'Pilih untuk melihat alur skrining awal NAYANA.',
    image_url: '/assets/demo-fundus/fundus-02.png',
  },
  {
    id: 'fundus-03',
    title: 'Contoh fundus 03',
    description: 'Pilih untuk melihat alur skrining awal NAYANA.',
    image_url: '/assets/demo-fundus/fundus-03.png',
  },
  {
    id: 'fundus-04',
    title: 'Contoh fundus 04',
    description: 'Pilih untuk melihat alur skrining awal NAYANA.',
    image_url: '/assets/demo-fundus/fundus-04.png',
  },
  {
    id: 'fundus-05',
    title: 'Contoh fundus 05',
    description: 'Pilih untuk melihat alur skrining awal NAYANA.',
    image_url: '/assets/demo-fundus/fundus-05.png',
  },
  {
    id: 'fundus-06',
    title: 'Contoh fundus 06',
    description: 'Pilih untuk melihat alur skrining awal NAYANA.',
    image_url: '/assets/demo-fundus/fundus-06.jpg',
  },
]

export type Prediction = {
  key: string
  label: string
  score: number
}

export type ScreeningResult = {
  screening_id: string
  source: 'demo' | 'upload'
  case_id?: string | null
  model_version: string
  top_prediction: Prediction
  predictions: Prediction[]
  disclaimer: string
}

export type ExecutiveSummary = {
  title: string
  overview: string
  general_information: string
  common_factors: string
  what_to_notice: string
  next_step: string
  disclaimer: string
}

const SUMMARY_DISCLAIMER = 'Bukan diagnosis medis. Konfirmasi dengan dokter mata.'

// These are reviewed, category-level educational summaries. They intentionally
// do not use a person’s image, score, symptoms, or chat history, so returning
// them locally avoids an LLM request on every screening result.
const CONDITION_SUMMARIES: Record<string, ExecutiveSummary> = {
  cataract: {
    title: 'Tentang katarak',
    general_information: 'Katarak adalah kekeruhan pada lensa mata yang membantu memfokuskan cahaya ke retina. Seiring kekeruhan bertambah, penglihatan dapat terasa buram atau berkabut, warna tampak kurang cerah, dan cahaya dapat terasa menyilaukan.',
    overview: 'Katarak paling sering berkaitan dengan perubahan alami pada mata seiring bertambahnya usia, ketika protein pada lensa dapat menggumpal. Diabetes, riwayat cedera atau operasi mata, penggunaan steroid, merokok, dan paparan sinar matahari juga dapat menjadi faktor yang perlu dibahas pada pemeriksaan langsung.',
    common_factors: 'Usia, diabetes, riwayat keluarga, cedera atau operasi mata, penggunaan steroid, merokok, dan paparan sinar matahari dapat meningkatkan risiko katarak.',
    what_to_notice: 'Perhatikan perubahan penglihatan yang mengganggu aktivitas, silau, atau warna yang terasa memudar.',
    next_step: 'Dokter mata dapat menilai lensa dan bagian mata lain melalui pemeriksaan langsung untuk menentukan apakah ada langkah lanjutan yang diperlukan.',
    disclaimer: SUMMARY_DISCLAIMER,
  },
  diabetic_retinopathy: {
    title: 'Tentang retinopati diabetik',
    general_information: 'Retinopati diabetik berkaitan dengan perubahan pada pembuluh darah retina, yaitu lapisan peka cahaya di bagian belakang mata. Pada tahap awal kondisi ini dapat belum menimbulkan keluhan, meskipun perubahan pada retina sudah dapat terjadi.',
    overview: 'Pada diabetes, gula darah yang tinggi dalam jangka waktu lama dapat merusak pembuluh darah kecil di retina. Lama hidup dengan diabetes, tekanan darah, dan kolesterol merupakan bagian dari konteks kesehatan yang dapat memengaruhi risiko dan perlu dibahas bersama tenaga kesehatan.',
    common_factors: 'Diabetes, lamanya diabetes, gula darah, tekanan darah, dan kolesterol merupakan konteks yang perlu dinilai bersama tenaga kesehatan.',
    what_to_notice: 'Perubahan penglihatan, seperti buram atau muncul bintik melayang, perlu disampaikan saat pemeriksaan.',
    next_step: 'Pemeriksaan mata dengan pelebaran pupil membantu dokter menilai retina dan menentukan tindak lanjut yang sesuai.',
    disclaimer: SUMMARY_DISCLAIMER,
  },
  glaucoma: {
    title: 'Tentang glaukoma',
    general_information: 'Glaukoma adalah kelompok kondisi yang dapat merusak saraf optik, yaitu saraf yang mengirimkan informasi visual dari mata ke otak. Perubahannya sering tidak terasa pada tahap awal, sehingga seseorang dapat tidak menyadari adanya gangguan penglihatan tepi.',
    overview: 'Penyebab jenis glaukoma yang paling umum belum sepenuhnya dipahami. Tekanan bola mata yang tinggi sering menjadi salah satu faktor, tetapi glaukoma juga dapat terjadi pada tekanan yang dianggap normal. Usia, riwayat keluarga, serta hasil pemeriksaan saraf optik dan lapang pandang membantu dokter menilai risikonya.',
    common_factors: 'Usia, riwayat keluarga, tekanan bola mata, saraf optik, dan lapang pandang perlu dipertimbangkan dalam pemeriksaan glaukoma.',
    what_to_notice: 'Sampaikan perubahan penglihatan, riwayat keluarga glaukoma, atau keluhan mata yang Anda alami kepada dokter.',
    next_step: 'Dokter mata dapat melakukan pemeriksaan menyeluruh untuk menilai saraf optik dan faktor lain yang tidak dapat dipastikan dari satu foto fundus.',
    disclaimer: SUMMARY_DISCLAIMER,
  },
  normal: {
    title: 'Tentang kategori normal',
    general_information: 'Kategori normal menjadi pola yang paling mirip pada hasil ini. Itu berarti model tidak menemukan pola dari tiga kategori lain yang lebih kuat pada foto yang dibandingkan.',
    overview: 'Kategori normal bukan jaminan bahwa mata bebas dari semua kondisi. Keluhan, riwayat kesehatan, dan faktor risiko dapat tidak terlihat dari satu foto fundus; beberapa kondisi mata juga dapat belum menimbulkan gejala pada tahap awal.',
    common_factors: 'Kesehatan mata tetap dipengaruhi oleh riwayat kesehatan, keluhan, dan faktor risiko yang tidak terlihat dari satu foto.',
    what_to_notice: 'Perhatikan perubahan penglihatan atau keluhan mata yang menetap maupun mendadak.',
    next_step: 'Lanjutkan pemeriksaan mata berkala sesuai kebutuhan dan konsultasikan bila ada keluhan atau faktor risiko.',
    disclaimer: SUMMARY_DISCLAIMER,
  },
}

export type ChatCitation = {
  id: number
  chunk_id: string
  title: string
  heading: string
  sections?: string[]
  url: string
  excerpt: string
  // Ordered to match each visible citation marker in the assistant answer.
  // Older saved conversations may not have this field.
  claims?: Array<{
    heading: string
    excerpt: string
    supporting_quotes?: string[]
  }>
  corpus_version: string
  source_updated_at?: string | null
  fetched_at: string
  attribution?: string
}

export type GroundingMetadata = {
  citations?: ChatCitation[]
  source_status?: 'grounded' | 'insufficient_evidence' | 'application_context' | null
  corpus_version?: string | null
}

export type ScreeningChatMessage = GroundingMetadata & {
  role: 'user' | 'assistant'
  content: string
}

export type ScreeningConversationIntent =
  | 'overview' | 'symptoms' | 'risk' | 'causes' | 'examination' | 'treatment' | 'prevention' | 'urgent'

export type ScreeningConversationMemory = {
  previous_intent?: ScreeningConversationIntent
}

export type ScreeningChatStreamStatus = 'retrieving' | 'generating' | 'attributing'

export type ScreeningChatStreamSentence = GroundingMetadata & {
  text: string
}

const conversationIntentRules: Array<[ScreeningConversationIntent, RegExp]> = [
  ['urgent', /mendadak|tiba.?tiba|nyeri.*hebat|sakit.*hebat|darurat/i],
  ['examination', /periksa|memeriksa|pemeriksaan|cek|tes|deteksi/i],
  ['treatment', /obat|terapi|operasi|ditangani|penanganan|sembuh/i],
  ['symptoms', /gejala|ciri|tanda|terasa|berasa/i],
  ['risk', /risiko|berisiko/i],
  ['causes', /penyebab|sebab|kenapa/i],
  ['prevention', /cegah|mencegah|menjaga|lindungi/i],
  ['overview', /apa itu|apa yang dimaksud|pengertian|gambaran/i],
]

/** Derives a tiny follow-up hint locally. No prior chat text is transmitted. */
export function compactConversationMemory(messages: ScreeningChatMessage[]): ScreeningConversationMemory | undefined {
  const previousQuestion = [...messages].reverse().find((message) => message.role === 'user')?.content || ''
  const previousIntent = conversationIntentRules.find(([, pattern]) => pattern.test(previousQuestion))?.[0]
  return previousIntent ? { previous_intent: previousIntent } : undefined
}

export type SuggestedQuestion = GroundingMetadata & {
  id: string
  question: string
  // RAG starter prompts are navigation only. Older stored rows may still carry
  // a fully grounded answer for backward compatibility.
  answer?: string | null
}

const configuredApiBase = import.meta.env.VITE_NAYANA_API_BASE_URL?.trim()
const apiBase = (configuredApiBase || 'http://localhost:8000').replace(/\/$/, '')
const configuredReportApiBase = import.meta.env.VITE_NAYANA_REPORT_API_BASE_URL?.trim()
const reportApiBase = configuredReportApiBase?.replace(/\/$/, '') || ''
const suggestedQuestionRequests = new Map<string, { request: Promise<SuggestedQuestion[]>; expiresAt: number }>()
const SUGGESTION_BROWSER_CACHE_MS = 5 * 60 * 1000

function apiUrl(path: string) {
  return `${apiBase}${path}`
}

function reportApiUrl(path: string) {
  if (!reportApiBase) {
    throw new Error('Layanan PDF belum dikonfigurasi. Tambahkan VITE_NAYANA_REPORT_API_BASE_URL.')
  }
  return reportApiBase + path
}

export function demoCaseImageUrl(caseId: string) {
  const demoCase = DEMO_CASES.find((item) => item.id === caseId)
  return demoCase?.image_url || ''
}

export function demoCaseIdFromScreeningId(screeningId: string) {
  if (!screeningId.startsWith('demo_')) return null
  const withSuffix = screeningId.slice('demo_'.length)
  const separatorIndex = withSuffix.lastIndexOf('_')
  if (separatorIndex <= 0) return null
  return withSuffix.slice(0, separatorIndex)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      headers: {
        Accept: 'application/json',
        ...init?.headers,
      },
    })
  } catch {
    throw new Error('Layanan NAYANA sedang tidak dapat dihubungi. Silakan coba lagi.')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail || 'Layanan skrining belum dapat dihubungi.')
  }

  return response.json() as Promise<T>
}

export function getDemoCases() {
  return Promise.resolve(DEMO_CASES)
}

export function startDemoScreening(caseId: string) {
  return request<ScreeningResult>('/v1/screenings/demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ case_id: caseId }),
  })
}

export function getScreeningResult(screeningId: string) {
  return request<ScreeningResult>(`/v1/screenings/${encodeURIComponent(screeningId)}`)
}

export function startUploadedScreening(
  image: File,
  ageConfirmed: boolean,
  processingConsent: boolean,
) {
  const formData = new FormData()
  formData.set('image', image)
  formData.set('age_confirmed', String(ageConfirmed))
  formData.set('processing_consent', String(processingConsent))

  return request<ScreeningResult>('/v1/screenings/upload', {
    method: 'POST',
    body: formData,
  })
}

export function getExecutiveSummary(screening: ScreeningResult) {
  const summary = CONDITION_SUMMARIES[screening.top_prediction.key]
  if (!summary) return Promise.reject(new Error('Ringkasan untuk kategori hasil ini belum tersedia.'))
  return Promise.resolve(summary)
}

export function askScreeningQuestion(options: {
  screening: ScreeningResult
  question: string
  memory?: ScreeningConversationMemory
}) {
  return request<{ answer: string } & GroundingMetadata>('/v1/screenings/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  })
}

export async function streamScreeningQuestion(options: {
  screening: ScreeningResult
  question: string
  memory?: ScreeningConversationMemory
}, callbacks: {
  onStatus: (stage: ScreeningChatStreamStatus) => void
  onSentence: (sentence: ScreeningChatStreamSentence) => void
}): Promise<GroundingMetadata> {
  let response: Response
  try {
    response = await fetch(apiUrl('/v1/screenings/chat/stream'), {
      method: 'POST',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    })
  } catch {
    throw new Error('Layanan NAYANA sedang tidak dapat dihubungi. Silakan coba lagi.')
  }

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail || 'Jawaban bersumber belum dapat disiapkan.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  let completed: GroundingMetadata | null = null

  function consumeEvent(rawEvent: string) {
    const lines = rawEvent.split('\n')
    const event = lines.find((line) => line.startsWith('event:'))?.slice('event:'.length).trim()
    const rawData = lines.filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim()).join('\n')
    if (!event || !rawData) return
    let data: Record<string, unknown>
    try {
      data = JSON.parse(rawData) as Record<string, unknown>
    } catch {
      throw new Error('Respons percakapan tidak dapat dibaca. Silakan coba lagi.')
    }
    if (event === 'status') {
      const stage = data.stage
      if (stage === 'retrieving' || stage === 'generating' || stage === 'attributing') callbacks.onStatus(stage)
      return
    }
    if (event === 'sentence') {
      if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('Respons percakapan tidak lengkap. Silakan coba lagi.')
      callbacks.onSentence({
        text: data.text,
        citations: Array.isArray(data.citations) ? data.citations as ChatCitation[] : [],
        source_status: data.source_status as GroundingMetadata['source_status'],
        corpus_version: typeof data.corpus_version === 'string' ? data.corpus_version : null,
      })
      return
    }
    if (event === 'complete') {
      completed = {
        citations: Array.isArray(data.citations) ? data.citations as ChatCitation[] : [],
        source_status: data.source_status as GroundingMetadata['source_status'],
        corpus_version: typeof data.corpus_version === 'string' ? data.corpus_version : null,
      }
      return
    }
    if (event === 'error') {
      throw new Error(typeof data.message === 'string' ? data.message : 'Jawaban bersumber belum dapat disiapkan.')
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffered += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n')
      let boundary = buffered.indexOf('\n\n')
      while (boundary >= 0) {
        consumeEvent(buffered.slice(0, boundary))
        buffered = buffered.slice(boundary + 2)
        boundary = buffered.indexOf('\n\n')
      }
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }

  if (!completed) throw new Error('Percakapan terputus sebelum jawaban selesai. Silakan coba lagi.')
  return completed
}

export function getSuggestedQuestions(options: {
  screening: ScreeningResult
  summary: ExecutiveSummary | null
}) {
  const key = `${options.screening.model_version}:${options.screening.predictions.map((item) => `${item.key}:${item.score.toFixed(3)}`).join('|')}`
  const existing = suggestedQuestionRequests.get(key)
  if (existing && existing.expiresAt > Date.now()) return existing.request
  if (existing) suggestedQuestionRequests.delete(key)

  const requestPromise = request<{ questions: SuggestedQuestion[] }>('/v1/screenings/suggested-questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  })
    .then((response) => response.questions)
    .catch(() => { throw new Error('Pertanyaan lanjutan belum tersedia. Anda tetap dapat menulis pertanyaan sendiri.') })

  suggestedQuestionRequests.set(key, { request: requestPromise, expiresAt: Date.now() + SUGGESTION_BROWSER_CACHE_MS })
  void requestPromise.catch(() => { suggestedQuestionRequests.delete(key) })
  return requestPromise
}

export async function downloadScreeningPdf(options: {
  screening: ScreeningResult
  summary: ExecutiveSummary | null
  fundusImage?: Blob | null
  discussionQuestions?: DiscussionQuestion[]
}) {
  const formData = new FormData()
  formData.set('screening', JSON.stringify(options.screening))
  formData.set('summary', JSON.stringify(options.summary))
  formData.set('discussion_questions', JSON.stringify((options.discussionQuestions || []).slice(0, 3)))
  if (options.fundusImage) {
    formData.set('fundus_image', options.fundusImage, 'nayana-foto-fundus.jpg')
  }

  let response: Response
  try {
    response = await fetch(reportApiUrl('/v1/screenings/report.pdf'), {
      method: 'POST',
      headers: { Accept: 'application/pdf' },
      body: formData,
    })
  } catch {
    throw new Error('Layanan PDF sedang tidak dapat dihubungi. Silakan coba lagi.')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail || 'PDF belum dapat dibuat.')
  }
  return response.blob()
}
