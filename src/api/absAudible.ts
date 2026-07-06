/**
 * HearthShelf's Audible catalog series lookup against the connected server's
 * HearthShelf backend (/hs/audible/*). Reached the same way as absRequests.ts:
 * the connected server's public origin + the per-server ABS bearer token. ABS
 * exposes no series ASIN, so the backend resolves it and returns the child books
 * ordered by sequence. Degrades to an empty (unresolved) result on any failure
 * so callers can quietly skip the "missing books" surface.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from './absLibrary'
import type { HSAudibleSearchResponse, HSAudibleSeriesResponse } from '@hearthshelf/core'

export type AudibleSearchResponse = HSAudibleSearchResponse
export type AudibleSeriesResponse = HSAudibleSeriesResponse

export const audibleKeys = {
  search: (name: string, page = 1) => ['audible', 'search', name, page] as const,
  series: (name: string) => ['audible', 'series', name] as const,
}

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

/**
 * Fetch a series' full Audible roster by name. Returns an unresolved result
 * (`seriesAsin: null, books: []`) on any failure - unreachable server, slim
 * deploy without /hs/audible, missing token, or no confident series match.
 */
export async function fetchAudibleSeries(
  t: AbsTarget,
  name: string,
): Promise<AudibleSeriesResponse> {
  const empty: AudibleSeriesResponse = { name, seriesAsin: null, books: [] }
  const token = getAbsToken(t.serverId)
  if (!token || name.trim().length < 2) return empty
  try {
    const res = await fetch(`${origin(t)}/hs/audible/series?q=${encodeURIComponent(name)}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return empty
    return (await res.json()) as AudibleSeriesResponse
  } catch {
    return empty
  }
}

/**
 * Search the Audible catalog by keyword through the connected server's
 * HearthShelf backend. Works whether or not the request backend is connected -
 * discovery is HearthShelf's own. Returns an empty result on any failure
 * (unreachable server, slim deploy without /hs/audible, missing token) so the
 * "Not in your library" section quietly hides.
 */
export async function searchAudible(
  t: AbsTarget,
  query: string,
  page = 1,
): Promise<AudibleSearchResponse> {
  const empty: AudibleSearchResponse = { query, results: [], totalResults: 0, page, hasMore: false }
  const token = getAbsToken(t.serverId)
  if (!token || query.trim().length < 2) return empty
  try {
    const res = await fetch(
      `${origin(t)}/hs/audible/search?q=${encodeURIComponent(query)}&page=${page}`,
      { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) return empty
    return (await res.json()) as AudibleSearchResponse
  } catch {
    return empty
  }
}

// A plain Audible store link for a missing book, used by the "Buy on Audible"
// action when the request backend isn't connected.
export function audibleStoreUrl(book: { asin?: string; title: string; author: string }): string {
  if (book.asin) return `https://www.audible.com/pd/${book.asin}`
  return (
    'https://www.audible.com/search?keywords=' + encodeURIComponent(`${book.title} ${book.author}`)
  )
}
