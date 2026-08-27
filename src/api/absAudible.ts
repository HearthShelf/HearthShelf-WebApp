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
import type {
  HSAudibleSearchResponse,
  HSAudibleSearchResult,
  HSAudibleSeriesResponse,
} from '@hearthshelf/core'

export type AudibleSearchResponse = HSAudibleSearchResponse
export type AudibleSeriesResponse = HSAudibleSeriesResponse

export const audibleKeys = {
  search: (name: string, page = 1) => ['audible', 'search', name, page] as const,
  // Keyed by ABS series id, not name - two distinct series can share a name
  // (Karevik's "Accidental Champion" vs Herzman's), and a name-only key made
  // them collide in the cache.
  series: (seriesId: string, name: string) => ['audible', 'series', seriesId, name] as const,
  // Keyed by the Audible series ASIN, for callers that hold only that (a series
  // follow, which stores the ASIN rather than an ABS series id).
  seriesByAsin: (seriesAsin: string) => ['audible', 'series-asin', seriesAsin] as const,
  product: (asin: string) => ['audible', 'product', asin] as const,
  // Owned/total counts for every swept series on this server, for the library
  // grid. Server-scoped, not library-scoped: the store is per instance.
  seriesSummary: (serverId: string) => ['audible', 'series-summary', serverId] as const,
  // This is library-specific even though its input is an Audible ASIN: the
  // returned id belongs to the connected server's ABS library.
  libraryItem: (serverId: string | undefined, asin: string) =>
    ['audible', 'library-item', serverId, asin] as const,
}

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

/** Owned/total counts for one series, as the library grid reads them. */
export interface SeriesGapSummary {
  seriesId: string
  /** Books in the series after phantom/duplicate filtering, released or not. */
  total: number
  /** Released books the library doesn't hold. Excludes unreleased ones - nobody
   *  could own those, and counting them would leave a caught-up series
   *  permanently incomplete. */
  missing: number
  /** Books announced but not out yet. */
  upcoming: number
  resolvedAt: number
}

/**
 * Gap counts for every series the nightly sweep has resolved, in one request.
 *
 * The library's series grid needs one fact per card for hundreds of cards, so
 * this returns counts only - fetching the rosters themselves would be megabytes
 * to render a badge. Series the sweep hasn't reached are simply absent, and the
 * grid shows those exactly as it did before (no badge).
 *
 * Degrades to an empty list on any failure: these counts are decoration, and a
 * library page must still render without them.
 */
export async function fetchSeriesGapSummaries(t: AbsTarget): Promise<SeriesGapSummary[]> {
  const token = getAbsToken(t.serverId)
  if (!token) return []
  try {
    const res = await fetch(`${origin(t)}/hs/audible/series-summary`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return []
    const body = (await res.json()) as { series?: SeriesGapSummary[] }
    return body.series ?? []
  } catch {
    return []
  }
}

/**
 * Fetch a series' full Audible roster. Returns an unresolved result
 * (`seriesAsin: null, books: []`) on any failure - unreachable server, slim
 * deploy without /hs/audible, missing token, or no confident series match.
 *
 * `seriesId` is ABS's own series id and is what identifies the series; the name
 * rides along because it's the Audible search term. Two distinct series can
 * share a name, so the id is what keeps their rosters apart.
 *
 * Older servers predating the seriesId parameter simply ignore it and fall back
 * to the name lookup, so this stays compatible with whatever version the user's
 * box is running.
 */
export async function fetchAudibleSeries(
  t: AbsTarget,
  seriesId: string,
  name: string,
): Promise<AudibleSeriesResponse> {
  const empty: AudibleSeriesResponse = { name, seriesAsin: null, books: [] }
  const token = getAbsToken(t.serverId)
  if (!token || name.trim().length < 2) return empty
  try {
    const params = new URLSearchParams({ q: name, seriesId })
    const res = await fetch(`${origin(t)}/hs/audible/series?${params.toString()}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return empty
    return (await res.json()) as AudibleSeriesResponse
  } catch {
    return empty
  }
}

/**
 * Fetch a series' roster by its Audible series ASIN. What a series follow holds
 * is the ASIN, not an ABS series id, so this is how a "following" list learns
 * which book is next in a series being tracked.
 *
 * Served from the precomputed roster only (no live Audible resolve), so an
 * older server - or a series the nightly sweep hasn't reached - returns an
 * unresolved result and the caller quietly shows the follow without a next-book
 * line.
 */
export async function fetchAudibleSeriesByAsin(
  t: AbsTarget,
  seriesAsin: string,
): Promise<AudibleSeriesResponse> {
  const empty: AudibleSeriesResponse = { name: '', seriesAsin: null, books: [] }
  const token = getAbsToken(t.serverId)
  if (!token || !seriesAsin) return empty
  try {
    const params = new URLSearchParams({ seriesAsin })
    const res = await fetch(`${origin(t)}/hs/audible/series?${params.toString()}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return empty
    return (await res.json()) as AudibleSeriesResponse
  } catch {
    return empty
  }
}

/**
 * One Audible product by ASIN. Backs the upcoming-book page, which has to render
 * a book the library does not have (so ABS knows nothing about it). null on any
 * failure or an unknown ASIN, so the page can show a not-found state.
 */
export async function fetchAudibleProduct(
  t: AbsTarget,
  asin: string,
): Promise<HSAudibleSearchResult | null> {
  const token = getAbsToken(t.serverId)
  if (!token || !asin) return null
  try {
    const res = await fetch(`${origin(t)}/hs/audible/product?asin=${encodeURIComponent(asin)}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    return (await res.json()) as HSAudibleSearchResult
  } catch {
    return null
  }
}

/**
 * Resolve an Audible ASIN to the connected server's library item, if that book
 * has arrived. This keeps durable /upcoming/:asin links useful after a release:
 * a saved link opens the real book detail page as soon as ABS indexes the book.
 *
 * Older self-hosted servers simply return null (including a 404 for the newer
 * endpoint), preserving the catalog-backed upcoming page for them.
 */
export async function fetchLibraryItemByAsin(t: AbsTarget, asin: string): Promise<string | null> {
  const token = getAbsToken(t.serverId)
  if (!token || !asin) return null
  try {
    const res = await fetch(
      `${origin(t)}/hs/audible/library-item?asin=${encodeURIComponent(asin)}`,
      { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { libraryItemId?: unknown }
    return typeof data.libraryItemId === 'string' && data.libraryItemId ? data.libraryItemId : null
  } catch {
    return null
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
