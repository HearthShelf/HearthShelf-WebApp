/**
 * Typed ABS library reads (libraries + items) over the direct ABS client.
 *
 * Field shapes verified against audiobookshelf 2.35.1 serializers. We use the
 * minified item form for lists (denormalized title/authorName, cover via the
 * item's /cover endpoint). Only the fields we render are typed.
 */
import { absGet, absMediaUrl } from './absClient'

export interface AbsTarget {
  serverId: string
  serverUrl: string
}

export interface AbsLibrary {
  id: string
  name: string
  mediaType: 'book' | 'podcast'
  icon: string
}

interface LibrariesResponse {
  libraries: AbsLibrary[]
}

export async function getLibraries(t: AbsTarget): Promise<AbsLibrary[]> {
  const data = await absGet<LibrariesResponse>(t, '/api/libraries')
  return data.libraries ?? []
}

/** A library item as we render it in a grid (from the minified list form). */
export interface AbsListItem {
  id: string
  title: string
  author: string
  mediaType: 'book' | 'podcast'
  durationSec: number
}

interface RawListItem {
  id: string
  mediaType: 'book' | 'podcast'
  media?: {
    metadata?: { title?: string; authorName?: string }
    duration?: number
  }
}

interface LibraryItemsResponse {
  results: RawListItem[]
  total: number
  page: number
  limit: number
}

export interface LibraryItemsPage {
  items: AbsListItem[]
  total: number
  page: number
  limit: number
}

export async function getLibraryItems(
  t: AbsTarget,
  libraryId: string,
  opts: { page?: number; limit?: number } = {}
): Promise<LibraryItemsPage> {
  const page = opts.page ?? 0
  const limit = opts.limit ?? 30
  const data = await absGet<LibraryItemsResponse>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/items?minified=1&limit=${limit}&page=${page}`
  )
  return {
    items: (data.results ?? []).map((r) => ({
      id: r.id,
      title: r.media?.metadata?.title || 'Untitled',
      author: r.media?.metadata?.authorName || '',
      mediaType: r.mediaType,
      durationSec: r.media?.duration ?? 0,
    })),
    total: data.total ?? 0,
    page: data.page ?? page,
    limit: data.limit ?? limit,
  }
}

/** Tokenized cover URL for an item (for <img src>), or null if not connected. */
export function itemCoverUrl(t: AbsTarget, itemId: string, width = 240): string | null {
  return absMediaUrl(t, `/api/items/${encodeURIComponent(itemId)}/cover?width=${width}`)
}
