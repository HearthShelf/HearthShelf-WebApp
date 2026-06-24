/**
 * Typed ABS library reads (libraries + items) over the direct ABS client.
 *
 * Field shapes verified against audiobookshelf 2.35.1 serializers. We use the
 * minified item form for lists (denormalized title/authorName, cover via the
 * item's /cover endpoint). Only the fields we render are typed.
 */
import { absGet, absPatch, absMediaUrl } from './absClient'

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

// --- personalized shelves (home) -------------------------------------------

interface RawShelf {
  id: string
  label: string
  entities?: RawListItem[]
}

export interface Shelf {
  id: string
  label: string
  items: AbsListItem[]
}

function mapRawItems(raw: RawListItem[]): AbsListItem[] {
  return raw.map((r) => ({
    id: r.id,
    title: r.media?.metadata?.title || 'Untitled',
    author: r.media?.metadata?.authorName || '',
    mediaType: r.mediaType,
    durationSec: r.media?.duration ?? 0,
  }))
}

/**
 * Personalized home shelves for one library (continue-listening, recently-added,
 * etc.). One call returns full item data per shelf. We surface the shelves we
 * render; callers pick by id.
 */
export async function getPersonalizedShelves(
  t: AbsTarget,
  libraryId: string,
  limit = 12
): Promise<Shelf[]> {
  const raw = await absGet<RawShelf[]>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/personalized?limit=${limit}`
  )
  return (raw ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    items: mapRawItems(s.entities ?? []),
  }))
}

// --- search ----------------------------------------------------------------

interface SearchEntry {
  libraryItem?: RawListItem
}

interface SearchResponse {
  book?: SearchEntry[]
  podcast?: SearchEntry[]
}

/**
 * Search a library by title/author. ABS returns results keyed by media type,
 * each wrapping the same minified item shape we use elsewhere. We flatten
 * book+podcast hits into AbsListItem. Empty query returns no results without
 * hitting the server (ABS 400s on an empty q).
 */
export async function searchLibrary(
  t: AbsTarget,
  libraryId: string,
  query: string,
  limit = 24
): Promise<AbsListItem[]> {
  const q = query.trim()
  if (!q) return []
  const data = await absGet<SearchResponse>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/search?q=${encodeURIComponent(q)}&limit=${limit}`
  )
  const entries = [...(data.book ?? []), ...(data.podcast ?? [])]
  return entries
    .map((e) => e.libraryItem)
    .filter((i): i is RawListItem => Boolean(i))
    .map((r) => ({
      id: r.id,
      title: r.media?.metadata?.title || 'Untitled',
      author: r.media?.metadata?.authorName || '',
      mediaType: r.mediaType,
      durationSec: r.media?.duration ?? 0,
    }))
}

// --- item detail + playback ------------------------------------------------

/** One audio track in a book, with its cumulative offset from book start. */
export interface AbsTrack {
  ino: string
  index: number
  startOffsetSec: number
  durationSec: number
  /** Tokenized URL the <audio> element streams. Null if not connected. */
  url: string | null
}

export interface AbsChapter {
  id: number
  title: string
  startSec: number
  endSec: number
}

export interface AbsItemDetail {
  id: string
  title: string
  author: string
  narrator: string
  description: string
  durationSec: number
  coverUrl: string | null
  tracks: AbsTrack[]
  chapters: AbsChapter[]
  /** Saved position for this user, if any. */
  progress: { currentTimeSec: number; isFinished: boolean } | null
}

interface RawTrack {
  ino: string
  index: number
  startOffset: number
  duration: number
  contentUrl: string
}

interface RawChapter {
  id: number
  title?: string
  start?: number
  end?: number
}

interface RawItemDetail {
  id: string
  media?: {
    duration?: number
    metadata?: {
      title?: string
      authorName?: string
      narratorName?: string
      description?: string
    }
    tracks?: RawTrack[]
    chapters?: RawChapter[]
  }
  userMediaProgress?: { currentTime?: number; isFinished?: boolean } | null
}

export async function getItemDetail(t: AbsTarget, itemId: string): Promise<AbsItemDetail> {
  const r = await absGet<RawItemDetail>(
    t,
    `/api/items/${encodeURIComponent(itemId)}?expanded=1&include=progress`
  )
  const md = r.media?.metadata
  const tracks: AbsTrack[] = (r.media?.tracks ?? []).map((tr) => ({
    ino: tr.ino,
    index: tr.index,
    startOffsetSec: tr.startOffset ?? 0,
    durationSec: tr.duration ?? 0,
    // contentUrl is "/api/items/{id}/file/{ino}"; add the auth token for <audio>.
    url: absMediaUrl(t, tr.contentUrl),
  }))
  return {
    id: r.id,
    title: md?.title || 'Untitled',
    author: md?.authorName || '',
    narrator: md?.narratorName || '',
    description: md?.description || '',
    durationSec: r.media?.duration ?? 0,
    coverUrl: itemCoverUrl(t, r.id, 480),
    tracks,
    chapters: (r.media?.chapters ?? []).map((c) => ({
      id: c.id,
      title: c.title || `Chapter ${c.id + 1}`,
      startSec: c.start ?? 0,
      endSec: c.end ?? 0,
    })),
    progress: r.userMediaProgress
      ? {
          currentTimeSec: r.userMediaProgress.currentTime ?? 0,
          isFinished: Boolean(r.userMediaProgress.isFinished),
        }
      : null,
  }
}

/** Save listening progress (stateless; no play session needed). */
export async function saveProgress(
  t: AbsTarget,
  itemId: string,
  currentTimeSec: number,
  durationSec: number
): Promise<void> {
  await absPatch(t, `/api/me/progress/${encodeURIComponent(itemId)}`, {
    currentTime: currentTimeSec,
    duration: durationSec,
  })
}
