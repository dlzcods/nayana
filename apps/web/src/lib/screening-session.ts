import type { ExecutiveSummary, ScreeningResult, ScreeningChatMessage } from './screening-api'

const keyPrefix = 'nayana.active-screening.'

export function getSessionChat(screeningId: string): ScreeningChatMessage[] {
  try {
    const messages = JSON.parse(window.sessionStorage.getItem(`nayana.session-chat.${screeningId}`) || '[]')
    return Array.isArray(messages) ? messages.filter((row) => row && ['user', 'assistant'].includes(row.role) && typeof row.content === 'string') : []
  } catch { return [] }
}

export function saveSessionChat(screeningId: string, messages: ScreeningChatMessage[]) {
  try {
    window.sessionStorage.setItem(`nayana.session-chat.${screeningId}`, JSON.stringify(messages.slice(-100)))
    return true
  } catch { return false }
}

export type ActiveScreening = {
  screening: ScreeningResult
  summary: ExecutiveSummary | null
  chatAccess?: 'temporary' | 'saved'
  discussionQuestions?: string[]
}

export function saveActiveScreening(active: ActiveScreening) {
  window.sessionStorage.setItem(`${keyPrefix}${active.screening.screening_id}`, JSON.stringify(active))
}

export function getActiveScreening(screeningId: string): ActiveScreening | null {
  try {
    const raw = window.sessionStorage.getItem(`${keyPrefix}${screeningId}`)
    if (!raw) return null
    const active = JSON.parse(raw) as ActiveScreening
    return active.screening?.screening_id === screeningId ? active : null
  } catch {
    return null
  }
}

export function setActiveScreeningChatAccess(screeningId: string, chatAccess: NonNullable<ActiveScreening['chatAccess']>) {
  const active = getActiveScreening(screeningId)
  if (!active) return
  saveActiveScreening({ ...active, chatAccess })
}
