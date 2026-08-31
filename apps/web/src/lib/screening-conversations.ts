import { authenticatedSupabaseFetch, resolveAuthSession, supabaseUrl } from './supabase-auth'
import type { ScreeningChatMessage } from './screening-api'

export type ScreeningConversation = {
  id: string
  screening_record_id: string
  created_at: string
  updated_at: string
}

type StoredChatMessage = ScreeningChatMessage & {
  id: string
  conversation_id: string
  created_at: string
}

const pendingConversationRequests = new Map<string, Promise<ScreeningConversation>>()

function requireSupabaseUrl() {
  if (!supabaseUrl) throw new Error('Penyimpanan akun belum dikonfigurasi.')
  return supabaseUrl
}

async function responseError(response: Response, fallback: string) {
  if (response.status === 401 || response.status === 403) {
    return new Error('Sesi akun tidak lagi valid. Keluar lalu masuk kembali, kemudian coba ulang.')
  }
  if (response.status === 404) return new Error('Percakapan untuk hasil ini belum tersedia.')
  return new Error(fallback)
}

export async function getOrCreateConversation(recordId: string) {
  const activeRequest = pendingConversationRequests.get(recordId)
  if (activeRequest) return activeRequest

  const request = getOrCreateConversationOnce(recordId)
  pendingConversationRequests.set(recordId, request)
  try {
    return await request
  } finally {
    pendingConversationRequests.delete(recordId)
  }
}

async function getOrCreateConversationOnce(recordId: string) {
  requireSupabaseUrl()
  const existing = await authenticatedSupabaseFetch(
    `/rest/v1/screening_conversations?select=id,screening_record_id,created_at,updated_at&screening_record_id=eq.${encodeURIComponent(recordId)}&limit=1`,
  )
  if (!existing.ok) throw await responseError(existing, 'Percakapan belum dapat dibuka.')
  const found = await existing.json() as ScreeningConversation[]
  if (found[0]) return found[0]

  const session = await resolveAuthSession()
  if (!session?.userId) throw new Error('Sesi akun belum lengkap. Masuk kembali untuk memulai percakapan.')
  const response = await authenticatedSupabaseFetch(`/rest/v1/screening_conversations?on_conflict=screening_record_id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // This makes the unique result-to-room constraint idempotent across
      // a double click, React Strict Mode, or two browser tabs.
      Prefer: 'resolution=ignore-duplicates,return=representation',
    },
    body: JSON.stringify({ screening_record_id: recordId, user_id: session.userId }),
  })
  if (response.ok) {
    const created = await response.json() as ScreeningConversation[]
    if (created[0]) return created[0]
  }

  // The unique database constraint handles two tabs creating the same room at once.
  const raced = await authenticatedSupabaseFetch(
    `/rest/v1/screening_conversations?select=id,screening_record_id,created_at,updated_at&screening_record_id=eq.${encodeURIComponent(recordId)}&limit=1`,
  )
  if (raced.ok) {
    const records = await raced.json() as ScreeningConversation[]
    if (records[0]) return records[0]
  }
  throw await responseError(response, 'Percakapan belum dapat dibuat.')
}

export async function getConversationMessages(conversationId: string) {
  requireSupabaseUrl()
  const response = await authenticatedSupabaseFetch(
    `/rest/v1/screening_chat_messages?select=id,conversation_id,role,content,created_at&conversation_id=eq.${encodeURIComponent(conversationId)}&order=created_at.asc&limit=100`,
  )
  if (!response.ok) throw await responseError(response, 'Pesan percakapan belum dapat dimuat.')
  return response.json() as Promise<StoredChatMessage[]>
}

export async function saveConversationMessage(conversationId: string, message: ScreeningChatMessage) {
  requireSupabaseUrl()
  const cleanContent = message.content.trim()
  const maxLength = message.role === 'user' ? 900 : 4000
  if (!cleanContent || cleanContent.length > maxLength) {
    throw new Error(message.role === 'user'
      ? 'Pertanyaan perlu berisi maksimal 900 karakter.'
      : 'Jawaban asisten terlalu panjang untuk disimpan.')
  }
  const response = await authenticatedSupabaseFetch('/rest/v1/screening_chat_messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ conversation_id: conversationId, role: message.role, content: cleanContent }),
  })
  if (!response.ok) throw await responseError(response, 'Pesan belum dapat disimpan.')

  await authenticatedSupabaseFetch(`/rest/v1/screening_conversations?id=eq.${encodeURIComponent(conversationId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updated_at: new Date().toISOString() }),
  })
  return (await response.json() as StoredChatMessage[])[0]
}
