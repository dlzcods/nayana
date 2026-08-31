import type { ExecutiveSummary, ScreeningResult } from './screening-api'
import {
  authenticatedSupabaseFetch,
  isSupabaseConfigured,
  resolveAuthSession,
  supabaseUrl,
} from './supabase-auth'

const guestHistoryKey = 'nayana.guest.screening-history'
const guestHistoryLifetime = 3 * 24 * 60 * 60 * 1000
const privateBucket = 'fundus-private'

export type RetentionDays = 30 | 90

export type ScreeningHistoryItem = {
  id: string
  source: 'demo' | 'upload'
  model_version: string
  top_prediction_key: string
  top_prediction_label: string
  predictions: ScreeningResult['predictions']
  executive_summary: ExecutiveSummary | null
  retention_days: RetentionDays
  expires_at: string
  created_at: string
  photo_path: string | null
  origin_screening_id: string | null
}

export type HistoryFilters = {
  query?: string
  period?: 'all' | '7d' | '30d' | '90d'
  indication?: string
}

type GuestHistoryItem = {
  storedAt: number
  result: ScreeningResult
  summary: ExecutiveSummary | null
}

function isoAfterDays(days: RetentionDays) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

function cleanGuestHistory(): GuestHistoryItem[] {
  try {
    const raw = window.localStorage.getItem(guestHistoryKey)
    const parsed = raw ? JSON.parse(raw) as GuestHistoryItem[] : []
    const valid = parsed.filter((item) => Date.now() - item.storedAt < guestHistoryLifetime)
    window.localStorage.setItem(guestHistoryKey, JSON.stringify(valid))
    return valid
  } catch {
    return []
  }
}

export function saveGuestHistory(result: ScreeningResult, summary: ExecutiveSummary | null) {
  const history = cleanGuestHistory().filter((item) => item.result.screening_id !== result.screening_id)
  history.unshift({ storedAt: Date.now(), result, summary })
  window.localStorage.setItem(guestHistoryKey, JSON.stringify(history.slice(0, 12)))
}

export function getGuestHistory() {
  return cleanGuestHistory()
}

export async function saveAccountScreening(options: {
  result: ScreeningResult
  summary: ExecutiveSummary | null
  retentionDays: RetentionDays
  normalizedImage?: Blob | null
}) {
  if (!isSupabaseConfigured || !supabaseUrl) throw new Error('Penyimpanan akun belum dikonfigurasi.')
  const session = await resolveAuthSession()
  if (!session?.userId) throw new Error('Sesi akun belum lengkap. Coba muat ulang halaman ini.')

  const existing = await getAccountScreeningByOrigin(options.result.screening_id)
  if (existing) return { record: existing, wasExisting: true }

  const id = crypto.randomUUID()
  let photoPath: string | null = null

  if (options.normalizedImage) {
    photoPath = `${session.userId}/${id}.jpg`
    const upload = await authenticatedSupabaseFetch(`/storage/v1/object/${privateBucket}/${photoPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        'x-upsert': 'false',
      },
      body: options.normalizedImage,
    })
    if (!upload.ok) {
      throw await storageError(upload, 'Foto belum dapat disimpan secara privat.')
    }
  }

  const payload = {
    id,
    user_id: session.userId,
    origin_screening_id: options.result.screening_id,
    source: options.result.source,
    model_version: options.result.model_version,
    top_prediction_key: options.result.top_prediction.key,
    top_prediction_label: options.result.top_prediction.label,
    predictions: options.result.predictions,
    executive_summary: options.summary,
    retention_days: options.retentionDays,
    expires_at: isoAfterDays(options.retentionDays),
    photo_path: photoPath,
    photo_content_type: photoPath ? 'image/jpeg' : null,
    photo_bytes: options.normalizedImage?.size || null,
  }

  const save = await authenticatedSupabaseFetch('/rest/v1/screening_records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  })

  if (!save.ok) {
    if (photoPath) {
      await authenticatedSupabaseFetch(`/storage/v1/object/${privateBucket}/${photoPath}`, {
        method: 'DELETE',
      }).catch(() => undefined)
    }
    const concurrentRecord = await getAccountScreeningByOrigin(options.result.screening_id)
    if (concurrentRecord) return { record: concurrentRecord, wasExisting: true }
    throw await databaseError(save, 'Hasil belum dapat disimpan ke akun.')
  }

  const records = await save.json() as ScreeningHistoryItem[]
  return { record: records[0], wasExisting: false }
}

export async function getAccountScreeningByOrigin(originScreeningId: string) {
  if (!supabaseUrl) return null
  const response = await authenticatedSupabaseFetch(
    `/rest/v1/screening_records?select=id,source,model_version,top_prediction_key,top_prediction_label,predictions,executive_summary,retention_days,expires_at,created_at,photo_path,origin_screening_id&origin_screening_id=eq.${encodeURIComponent(originScreeningId)}&limit=1`,
  )
  if (!response.ok) throw await databaseError(response, 'Riwayat akun belum dapat diverifikasi.')
  const records = await response.json() as ScreeningHistoryItem[]
  return records[0] || null
}

export async function getAccountHistory(filters: HistoryFilters = {}) {
  if (!isSupabaseConfigured || !supabaseUrl) return [] as ScreeningHistoryItem[]
  const params = new URLSearchParams({
    select: 'id,source,model_version,top_prediction_key,top_prediction_label,predictions,executive_summary,retention_days,expires_at,created_at,photo_path,origin_screening_id',
    order: 'created_at.desc',
  })
  const query = filters.query?.trim()
  if (query) params.set('top_prediction_label', `ilike.*${query.replace(/[*,().]/g, ' ')}*`)
  if (filters.indication && filters.indication !== 'all') params.set('top_prediction_key', `eq.${filters.indication}`)
  const after = periodStart(filters.period || 'all')
  if (after) params.set('created_at', `gte.${after.toISOString()}`)
  const response = await authenticatedSupabaseFetch(
    `/rest/v1/screening_records?${params.toString()}`,
  )
  if (!response.ok) throw await databaseError(response, 'Riwayat belum dapat dimuat.')
  return response.json() as Promise<ScreeningHistoryItem[]>
}

export async function getAccountHistoryRecord(recordId: string) {
  if (!isSupabaseConfigured || !supabaseUrl) return null
  const response = await authenticatedSupabaseFetch(
    `/rest/v1/screening_records?select=id,source,model_version,top_prediction_key,top_prediction_label,predictions,executive_summary,retention_days,expires_at,photo_path,origin_screening_id&id=eq.${encodeURIComponent(recordId)}&limit=1`,
  )
  if (!response.ok) throw await databaseError(response, 'Hasil riwayat belum dapat dibuka.')
  const records = await response.json() as ScreeningHistoryItem[]
  return records[0] || null
}

export async function getAccountPhoto(record: Pick<ScreeningHistoryItem, 'photo_path'>, signal?: AbortSignal) {
  if (!supabaseUrl || !record.photo_path) return null
  const response = await authenticatedSupabaseFetch(`/storage/v1/object/${privateBucket}/${record.photo_path}`, { signal })
  if (response.status === 404) return null
  if (!response.ok) throw await storageError(response, 'Foto privat belum dapat dimuat.')
  return URL.createObjectURL(await response.blob())
}

export function screeningFromHistory(record: ScreeningHistoryItem): ScreeningResult {
  const topPrediction = record.predictions.find((prediction) => prediction.key === record.top_prediction_key)
    || { key: record.top_prediction_key, label: record.top_prediction_label, score: 0 }
  return {
    screening_id: record.origin_screening_id || record.id,
    source: record.source,
    model_version: record.model_version,
    top_prediction: topPrediction,
    predictions: record.predictions,
    disclaimer: 'Hasil ini menggambarkan kemiripan pola pada foto fundus, bukan tingkat keparahan dan bukan penetapan kondisi medis. Konsultasikan dengan dokter spesialis mata (Sp.M).',
  }
}

function periodStart(period: NonNullable<HistoryFilters['period']>) {
  if (period === 'all') return null
  const days = Number.parseInt(period, 10)
  const start = new Date()
  start.setDate(start.getDate() - days)
  return start
}

export async function deleteAccountHistory(record: ScreeningHistoryItem) {
  if (!supabaseUrl) throw new Error('Penyimpanan akun belum dikonfigurasi.')
  if (record.photo_path) {
    const removePhoto = await authenticatedSupabaseFetch(`/storage/v1/object/${privateBucket}/${record.photo_path}`, {
      method: 'DELETE',
    })
    if (!removePhoto.ok) throw await storageError(removePhoto, 'Foto belum dapat dihapus secara privat.')
  }
  const response = await authenticatedSupabaseFetch(`/rest/v1/screening_records?id=eq.${encodeURIComponent(record.id)}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw await databaseError(response, 'Hasil belum dapat dihapus.')
}

async function errorDetails(response: Response) {
  try {
    const body = await response.json() as { message?: string; hint?: string; code?: string }
    return [body.code, body.message, body.hint].filter(Boolean).join(' ')
  } catch {
    return ''
  }
}

async function databaseError(response: Response, fallback: string) {
  const details = await errorDetails(response)
  if (response.status === 401 || response.status === 403) {
    return new Error('Sesi akun tidak lagi valid. Keluar lalu masuk kembali, kemudian coba ulang.')
  }
  if (response.status === 404 || /origin_screening_id|screening_records/i.test(details)) {
    return new Error('Penyimpanan akun belum siap. Jalankan migration Supabase NAYANA terlebih dahulu.')
  }
  return new Error(fallback)
}

async function storageError(response: Response, fallback: string) {
  const details = await errorDetails(response)
  if (response.status === 401 || response.status === 403) {
    return new Error('Sesi akun tidak lagi valid. Keluar lalu masuk kembali, kemudian coba ulang.')
  }
  if (response.status === 404 || /bucket|fundus-private/i.test(details)) {
    return new Error('Penyimpanan foto privat belum siap. Jalankan migration Supabase NAYANA terlebih dahulu.')
  }
  return new Error(fallback)
}
