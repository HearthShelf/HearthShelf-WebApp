/**
 * ReadMeABook (RMAB) request layer against the connected server's HearthShelf
 * backend.
 *
 * Like absSocial.ts (the leaderboard), these endpoints live under /hs/rmab/* on
 * the connected server's own origin and are served by the HearthShelf Node
 * backend (NOT the ABS-native /api/* surface). We reach them the same way
 * absClient does: the server's public origin + the per-server ABS bearer token.
 *
 * Every call degrades to a neutral/empty value on ANY error (network, 404,
 * missing token, a slim deploy that doesn't expose /hs/rmab). The Requests
 * surface is hidden entirely when the feature reports disabled, so this never
 * breaks the app. Request/response shapes mirror HearthShelf's own requests.ts.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from './absLibrary'

// --- Status model (colors + labels adopted verbatim from ReadMeABook) --------

export type RmabGroup = 'active' | 'waiting' | 'completed' | 'failed' | 'cancelled'

export interface RmabStatusMeta {
  color: string
  label: string
  group: RmabGroup
}

export const RMAB_STATUS: Record<string, RmabStatusMeta> = {
  pending: { color: '#d9a45a', label: 'Pending', group: 'active' },
  searching: { color: '#4f9db0', label: 'Searching', group: 'active' },
  downloading: { color: '#9b6fb8', label: 'Downloading', group: 'active' },
  processing: { color: '#c4663a', label: 'Processing', group: 'active' },
  awaiting_approval: { color: '#d9a45a', label: 'Awaiting approval', group: 'waiting' },
  awaiting_search: { color: '#d9a45a', label: 'Awaiting search', group: 'waiting' },
  awaiting_import: { color: '#c4663a', label: 'Awaiting import', group: 'waiting' },
  awaiting_release: { color: '#2f9d8f', label: 'Awaiting release', group: 'waiting' },
  warn: { color: '#c4663a', label: 'Needs attention', group: 'failed' },
  downloaded: { color: '#5a9c52', label: 'Downloaded', group: 'completed' },
  available: { color: '#5a9c52', label: 'In library', group: 'completed' },
  failed: { color: '#d8443a', label: 'Failed', group: 'failed' },
  denied: { color: '#d8443a', label: 'Denied', group: 'failed' },
  cancelled: { color: '#8a847a', label: 'Cancelled', group: 'cancelled' },
}

export const RMAB_GROUPS: { id: RmabGroup; label: string; icon: string }[] = [
  { id: 'active', label: 'Active', icon: 'downloading' },
  { id: 'waiting', label: 'Waiting', icon: 'hourglass_top' },
  { id: 'completed', label: 'Completed', icon: 'task_alt' },
  { id: 'failed', label: 'Failed', icon: 'error' },
  { id: 'cancelled', label: 'Cancelled', icon: 'block' },
]

export function statusMeta(status: string): RmabStatusMeta {
  return RMAB_STATUS[status] ?? RMAB_STATUS.pending
}

// --- Shapes (subset we render; mirror HearthShelf's requests.ts) -------------

export interface RmabAudiobook {
  id: string
  audibleAsin: string | null
  title: string
  author: string | null
  narrator: string | null
  coverArtUrl: string | null
  absItemId: string | null // links to an ABS library item once acquired
}

export interface RmabRequest {
  id: string
  status: string
  type: 'audiobook' | 'ebook'
  progress: number
  errorMessage: string | null
  createdAt: string
  audiobook: RmabAudiobook
}

export interface RmabCounts {
  all: number
  active: number
  waiting: number
  completed: number
  failed: number
  cancelled: number
}

export interface RmabRequestsResponse {
  success: boolean
  requests: RmabRequest[]
  nextCursor: string | null
  counts: RmabCounts
}

export interface RmabSearchResult {
  asin: string
  title: string
  author: string
  narrator?: string
  description?: string
  coverArtUrl?: string
  durationMinutes?: number
  releaseDate?: string
  rating?: number
  isRequested?: boolean
  requestStatus?: string
  requestId?: string
  availableIn?: 'plex' | 'audiobookshelf'
}

export interface RmabConfig {
  /** True only when the backend explicitly reports the feature on. */
  enabled: boolean
}

export interface WatchedAuthor {
  id: string
  authorAsin: string
  authorName: string
}
export interface WatchedSeries {
  id: string
  seriesAsin: string
  seriesTitle: string
}

// --- Neutral fallbacks (returned on any failure) -----------------------------

const EMPTY_COUNTS: RmabCounts = {
  all: 0,
  active: 0,
  waiting: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
}
const EMPTY_LIST: RmabRequestsResponse = {
  success: false,
  requests: [],
  nextCursor: null,
  counts: EMPTY_COUNTS,
}
const FAIL = { success: false } as const

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

// Low-level fetch against /hs/rmab/* with the per-server ABS bearer token. Throws
// on any non-ok response or missing token so callers can map to a safe default.
async function rmabFetch<T>(
  t: AbsTarget,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/rmab${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  if (!res.ok) throw new Error(`RMAB ${res.status}`)
  return res.json() as Promise<T>
}

// --- Reads -------------------------------------------------------------------

/**
 * Is the RMAB backend enabled on this server? Returns { enabled: false } on any
 * failure (unreachable, slim deploy, missing token) so the nav + gate hide it.
 */
export async function getRmabConfig(t: AbsTarget): Promise<RmabConfig> {
  try {
    const data = await rmabFetch<{ enabled?: boolean; configured?: boolean }>(t, '/config')
    // Accept either flag the backend may send; require an explicit true.
    return { enabled: data.enabled === true || data.configured === true }
  } catch {
    return { enabled: false }
  }
}

/** List requests, optionally filtered by group. Empty list on any failure. */
export async function listRequests(
  t: AbsTarget,
  group?: string
): Promise<RmabRequestsResponse> {
  const qs =
    group && group !== 'all'
      ? `?status=${encodeURIComponent(group)}&take=100`
      : '?take=100'
  try {
    return await rmabFetch<RmabRequestsResponse>(t, `/requests${qs}`)
  } catch {
    return EMPTY_LIST
  }
}

/** Search the RMAB catalog. Empty results on any failure. */
export async function searchCatalog(
  t: AbsTarget,
  query: string
): Promise<{ results: RmabSearchResult[] }> {
  try {
    return await rmabFetch<{ results: RmabSearchResult[] }>(
      t,
      `/search?q=${encodeURIComponent(query)}`
    )
  } catch {
    return { results: [] }
  }
}

export async function listWatchedAuthors(
  t: AbsTarget
): Promise<{ success: boolean; authors: WatchedAuthor[] }> {
  try {
    return await rmabFetch<{ success: boolean; authors: WatchedAuthor[] }>(t, '/watched-authors')
  } catch {
    return { success: false, authors: [] }
  }
}

export async function listWatchedSeries(
  t: AbsTarget
): Promise<{ success: boolean; series: WatchedSeries[] }> {
  try {
    return await rmabFetch<{ success: boolean; series: WatchedSeries[] }>(t, '/watched-series')
  } catch {
    return { success: false, series: [] }
  }
}

// --- Writes (each resolves to a { success } result, never throws) ------------

export async function submitRequest(
  t: AbsTarget,
  audiobook: {
    asin: string
    title: string
    author: string
    narrator?: string
    description?: string
    coverArtUrl?: string
  }
): Promise<{ success: boolean; request?: RmabRequest; error?: string }> {
  try {
    return await rmabFetch(t, '/requests', {
      method: 'POST',
      body: JSON.stringify({ audiobook }),
    })
  } catch {
    return { success: false, error: 'Request failed' }
  }
}

export async function cancelRequest(
  t: AbsTarget,
  id: string
): Promise<{ success: boolean; message?: string }> {
  try {
    return await rmabFetch(t, `/requests/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'cancel' }),
    })
  } catch {
    return FAIL
  }
}

export async function retryRequest(
  t: AbsTarget,
  id: string
): Promise<{ success: boolean; message?: string }> {
  try {
    return await rmabFetch(t, `/requests/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'retry' }),
    })
  } catch {
    return FAIL
  }
}

/**
 * Fetch the matching ebook for a completed audiobook request. Requires the
 * service account to be an RMAB admin and ebook sources to be configured.
 */
export async function fetchEbook(
  t: AbsTarget,
  requestId: string
): Promise<{ success: boolean; message?: string; requestId?: string }> {
  try {
    return await rmabFetch(t, `/requests/${encodeURIComponent(requestId)}/ebook`, {
      method: 'POST',
    })
  } catch {
    return FAIL
  }
}

export async function watchAuthor(
  t: AbsTarget,
  input: { authorAsin: string; authorName: string; coverArtUrl?: string }
): Promise<{ success: boolean }> {
  try {
    return await rmabFetch(t, '/watched-authors', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  } catch {
    return FAIL
  }
}

export async function unwatchAuthor(t: AbsTarget, id: string): Promise<{ success: boolean }> {
  try {
    return await rmabFetch(t, `/watched-authors/${encodeURIComponent(id)}`, { method: 'DELETE' })
  } catch {
    return FAIL
  }
}

export async function watchSeries(
  t: AbsTarget,
  input: { seriesAsin: string; seriesTitle: string; coverArtUrl?: string }
): Promise<{ success: boolean }> {
  try {
    return await rmabFetch(t, '/watched-series', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  } catch {
    return FAIL
  }
}

export async function unwatchSeries(t: AbsTarget, id: string): Promise<{ success: boolean }> {
  try {
    return await rmabFetch(t, `/watched-series/${encodeURIComponent(id)}`, { method: 'DELETE' })
  } catch {
    return FAIL
  }
}
