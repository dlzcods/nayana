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

export type SuggestedQuestion = GroundingMetadata & {
  id: string
  question: string
  // Atomic citation mode returns navigation prompts only. Legacy cached packs
  // may still include a fully grounded answer for backward compatibility.
  answer?: string | null
}

const configuredApiBase = import.meta.env.VITE_NAYANA_API_BASE_URL?.trim()
const apiBase = (configuredApiBase || 'http://localhost:8000').replace(/\/$/, '')
const configuredReportApiBase = import.meta.env.VITE_NAYANA_REPORT_API_BASE_URL?.trim()
const reportApiBase = configuredReportApiBase?.replace(/\/$/, '') || ''
const executiveSummaryRequests = new Map<string, Promise<ExecutiveSummary>>()
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
  const existingRequest = executiveSummaryRequests.get(screening.screening_id)
  if (existingRequest) return existingRequest

  const requestPromise = request<ExecutiveSummary>('/v1/screenings/executive-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ screening }),
  })

  executiveSummaryRequests.set(screening.screening_id, requestPromise)
  void requestPromise.catch(() => {
    executiveSummaryRequests.delete(screening.screening_id)
  })
  return requestPromise
}

export function askScreeningQuestion(options: {
  screening: ScreeningResult
  summary: ExecutiveSummary | null
  messages: ScreeningChatMessage[]
}) {
  return request<{ answer: string } & GroundingMetadata>('/v1/screenings/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...options, messages: options.messages.slice(-10).map(({ role, content }) => ({ role, content })) }),
  })
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
