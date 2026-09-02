export type AuthSession = {
  accessToken: string
  refreshToken: string | null
  userId: string | null
  email: string | null
  displayName: string | null
}

const storageKey = 'nayana.auth.session'
export const authChangeEvent = 'nayana:auth-change'
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '')
export const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

function authHeaders() {
  if (!supabaseUrl || !supabasePublishableKey) throw new Error('Login belum dikonfigurasi.')
  return {
    apikey: supabasePublishableKey,
    Authorization: `Bearer ${supabasePublishableKey}`,
    'Content-Type': 'application/json',
  }
}

function saveSession(session: AuthSession) {
  window.localStorage.setItem(storageKey, JSON.stringify(session))
  window.dispatchEvent(new Event(authChangeEvent))
}

function clearSession() {
  window.localStorage.removeItem(storageKey)
  window.dispatchEvent(new Event(authChangeEvent))
}

export function getAuthSession(): AuthSession | null {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AuthSession>
    if (typeof parsed.accessToken !== 'string') return null
    return enrichLocalSession({
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
      userId: typeof parsed.userId === 'string' ? parsed.userId : null,
      email: typeof parsed.email === 'string' ? parsed.email : null,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : null,
    })
  } catch {
    return null
  }
}

export async function signOut() {
  const session = getAuthSession()
  clearSession()
  if (!session || !isSupabaseConfigured) return

  await fetch(`${supabaseUrl}/auth/v1/logout`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      Authorization: `Bearer ${session.accessToken}`,
    },
  }).catch(() => undefined)
}

type SupabaseUser = {
  id?: string | null
  email?: string | null
  user_metadata?: {
    full_name?: string | null
    name?: string | null
  }
}

type RefreshedSessionResponse = {
  access_token?: string
  refresh_token?: string
}

let activeRefresh: Promise<AuthSession | null> | null = null

type AccessTokenClaims = {
  sub?: string
  email?: string
  user_metadata?: {
    full_name?: string | null
    name?: string | null
  }
}

function getDisplayName(user: SupabaseUser) {
  const candidate = user.user_metadata?.full_name || user.user_metadata?.name || null
  return candidate?.trim() || null
}

function accessTokenClaims(accessToken: string): AccessTokenClaims | null {
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return null
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
    return JSON.parse(window.atob(padded)) as AccessTokenClaims
  } catch {
    return null
  }
}

function enrichLocalSession(session: AuthSession): AuthSession {
  const claims = accessTokenClaims(session.accessToken)
  const displayName = claims?.user_metadata?.full_name || claims?.user_metadata?.name || session.displayName
  return {
    ...session,
    userId: claims?.sub || session.userId,
    email: claims?.email || session.email,
    displayName: displayName?.trim() || null,
  }
}

export async function hydrateAuthSession(session: AuthSession) {
  if (!isSupabaseConfigured) return session

  let response: Response
  try {
    response = await fetchCurrentUser(session)
  } catch {
    // A DNS/offline failure must not erase a valid local session. The caller can
    // show a retryable connection message instead of repeatedly revalidating it.
    throw new Error('Koneksi ke layanan akun sedang tidak tersedia. Periksa koneksi lalu coba lagi.')
  }
  if (response.ok) return saveHydratedUser(session, response)

  if ((response.status === 401 || response.status === 403) && session.refreshToken) {
    const refreshedSession = await refreshAuthSession(session)
    if (!refreshedSession) {
      clearSession()
      return null
    }

    const refreshedUser = await fetchCurrentUser(refreshedSession)
    if (refreshedUser.ok) return saveHydratedUser(refreshedSession, refreshedUser)
    clearSession()
    return null
  }

  if (response.status === 401 || response.status === 403) clearSession()

  return session
}

async function fetchCurrentUser(session: AuthSession) {
  return fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      ...authHeaders(),
      Authorization: `Bearer ${session.accessToken}`,
    },
  })
}

async function saveHydratedUser(session: AuthSession, response: Response) {
  const user = await response.json() as SupabaseUser
  const hydratedSession: AuthSession = {
    ...session,
    userId: user.id || session.userId,
    email: user.email || session.email,
    displayName: getDisplayName(user) || session.displayName,
  }
  saveSession(hydratedSession)
  return hydratedSession
}

async function refreshAuthSession(session: AuthSession): Promise<AuthSession | null> {
  if (!session.refreshToken || !supabaseUrl || !supabasePublishableKey) return null
  if (activeRefresh) return activeRefresh

  activeRefresh = (async () => {
    let response: Response
    try {
      response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ refresh_token: session.refreshToken }),
      })
    } catch {
      throw new Error('Koneksi ke layanan akun sedang tidak tersedia. Periksa koneksi lalu coba lagi.')
    }
    if (!response.ok) return null

    const refreshed = await response.json() as RefreshedSessionResponse
    if (!refreshed.access_token || !refreshed.refresh_token) return null

    const nextSession = enrichLocalSession({
      ...session,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
    })
    saveSession(nextSession)
    return nextSession
  })()

  try {
    return await activeRefresh
  } finally {
    activeRefresh = null
  }
}

export async function resolveAuthSession() {
  // Rendering a signed-in state must not depend on an avoidable /auth/v1/user
  // request. The token is verified by Supabase when a protected resource is used.
  return getAuthSession()
}

export async function getAuthenticatedSupabaseHeaders() {
  const session = getAuthSession()
  if (!supabaseUrl || !supabasePublishableKey || !session?.accessToken) {
    throw new Error('Masuk ke akun NAYANA untuk melanjutkan.')
  }
  return {
    apikey: supabasePublishableKey,
    Authorization: `Bearer ${session.accessToken}`,
  }
}

export async function authenticatedSupabaseFetch(path: string, init: RequestInit = {}) {
  if (!supabaseUrl) throw new Error('Penyimpanan akun belum dikonfigurasi.')
  const session = getAuthSession()
  if (!supabasePublishableKey || !session?.accessToken) {
    throw new Error('Masuk ke akun NAYANA untuk melanjutkan.')
  }
  const request = async (accessToken: string) => fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: supabasePublishableKey,
      Authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
  })

  let response: Response
  try {
    response = await request(session.accessToken)
  } catch {
    throw new Error('Koneksi ke layanan akun sedang tidak tersedia. Periksa koneksi lalu coba lagi.')
  }

  if ((response.status !== 401 && response.status !== 403) || !session.refreshToken) return response

  const refreshed = await refreshAuthSession(session)
  if (!refreshed) return response
  try {
    return await request(refreshed.accessToken)
  } catch {
    throw new Error('Koneksi ke layanan akun sedang tidak tersedia. Periksa koneksi lalu coba lagi.')
  }
}

export async function completeOAuthSession() {
  const params = new URLSearchParams(window.location.hash.slice(1))
  const accessToken = params.get('access_token')
  if (!accessToken) return null

  const session = enrichLocalSession({
    accessToken,
    refreshToken: params.get('refresh_token'),
    userId: null,
    email: null,
    displayName: null,
  })
  saveSession(session)
  window.history.replaceState({}, document.title, window.location.pathname)
  return session
}

export function signInWithGoogle() {
  if (!supabaseUrl) throw new Error('Login belum dikonfigurasi.')
  const redirectTo = `${window.location.origin}/login`
  window.location.assign(`${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`)
}
