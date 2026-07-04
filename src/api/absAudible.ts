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
import type { HSAudibleSeriesResponse } from '@hearthshelf/core'

export type AudibleSeriesResponse = HSAudibleSeriesResponse

export const audibleKeys = {
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

// A plain Audible store link for a missing book, used by the "Buy on Audible"
// action when the request backend isn't connected.
export function audibleStoreUrl(book: { asin?: string; title: string; author: string }): string {
  if (book.asin) return `https://www.audible.com/pd/${book.asin}`
  return (
    'https://www.audible.com/search?keywords=' + encodeURIComponent(`${book.title} ${book.author}`)
  )
}
