import type { ExecutiveSummary, ScreeningResult } from './screening-api'

const keyPrefix = 'nayana.active-screening.'

export type ActiveScreening = {
  screening: ScreeningResult
  summary: ExecutiveSummary | null
  chatAccess?: 'temporary' | 'saved'
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
