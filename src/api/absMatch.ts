/**
 * Admin metadata Match + Cover writes against a server's ABS API.
 *
 * Mirrors HearthShelf's provider-search and match/cover endpoints, but routed
 * through the WebApp's direct ABS client (absClient.ts) so it shares the same
 * per-server token + silent-reconnect path. Admin-only; gated by the caller
 * (ItemEditModal is admin-only on the detail page).
 *
 * Endpoints (audiobookshelf 2.35.x):
 *   GET   /api/search/providers          -> provider lists (books/booksCovers/podcasts)
 *   GET   /api/search/books?provider&title&author  -> metadata match results
 *   GET   /api/search/covers?provider&title&author -> { results: string[] } cover URLs
 *   POST  /api/items/:id/match           -> apply a provider match to the item
 *   PATCH /api/items/:id/cover { url }    -> set the item cover from an external URL
 *
 * Cover handling: HS only sets covers from a URL (search result or pasted URL),
 * so the PATCH-with-url path covers both cases - no multipart upload is needed.
 */
import { absGet, absPatch, absPost } from './absClient'
import type { AbsTarget } from './absLibrary'
import type { MetadataProvider } from './absAdmin'

/** A metadata-provider search result; applied via matchItem. */
export interface AbsMatchResult {
  title: string
  subtitle: string | null
  author: string | null
  narrator: string | null
  publisher: string | null
  publishedYear: string | null
  description: string | null
  cover: string | null
  asin: string | null
  isbn: string | null
  genres: string[]
  series: { series: string; sequence: string | null }[]
  duration: number | null
}

interface SearchProvidersResponse {
  providers: {
    books: MetadataProvider[]
    booksCovers: MetadataProvider[]
    podcasts: MetadataProvider[]
  }
}

/** The metadata providers ABS can search (book + cover sources). */
export function getSearchProviders(t: AbsTarget): Promise<SearchProvidersResponse> {
  return absGet<SearchProvidersResponse>(t, '/api/search/providers')
}

/** Search a provider for book metadata matches. */
export function searchBookMetadata(
  t: AbsTarget,
  provider: string,
  title: string,
  author = '',
): Promise<AbsMatchResult[]> {
  const p = new URLSearchParams({ provider, title, author })
  return absGet<AbsMatchResult[]>(t, `/api/search/books?${p.toString()}`)
}

/** Search a provider for cover-image URLs. */
export async function searchCovers(
  t: AbsTarget,
  provider: string,
  title: string,
  author = '',
): Promise<string[]> {
  const p = new URLSearchParams({ provider, title, author })
  const res = await absGet<{ results: string[] }>(t, `/api/search/covers?${p.toString()}`)
  return res.results ?? []
}

export interface MatchItemBody {
  provider: string
  title?: string
  author?: string
  asin?: string | null
  isbn?: string | null
  overrideCover?: boolean
  overrideDetails?: boolean
}

/** Apply a provider match to an item (writes selected fields / cover). */
export async function matchItem(t: AbsTarget, itemId: string, body: MatchItemBody): Promise<void> {
  await absPost(t, `/api/items/${itemId}/match`, body)
}

/** Set the item cover from an external image URL. */
export async function updateItemCover(t: AbsTarget, itemId: string, url: string): Promise<void> {
  await absPatch(t, `/api/items/${itemId}/cover`, { url })
}
