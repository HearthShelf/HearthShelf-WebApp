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

// --- browse: series / author / collections ---------------------------------

/** A bare ABS library item (as returned inside author/collection/series lists). */
interface RawBareItem {
  id: string
  mediaType?: 'book' | 'podcast'
  media?: { metadata?: { title?: string; authorName?: string }; duration?: number }
}

function mapBareItem(r: RawBareItem): AbsListItem {
  return {
    id: r.id,
    title: r.media?.metadata?.title || 'Untitled',
    author: r.media?.metadata?.authorName || '',
    mediaType: r.mediaType || 'book',
    durationSec: r.media?.duration ?? 0,
  }
}

/** base64 (browser btoa) for ABS's filter param values. */
function b64(s: string): string {
  return typeof btoa !== 'undefined' ? btoa(s) : s
}

export interface SeriesSummary {
  id: string
  name: string
}

/** List the series in a library (for a series index). */
export async function getSeriesList(t: AbsTarget, libraryId: string): Promise<SeriesSummary[]> {
  const data = await absGet<{ results?: Array<{ id: string; name: string }> }>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/series?limit=0`
  )
  return (data.results ?? []).map((s) => ({ id: s.id, name: s.name }))
}

/** Ordered books in a series, via the items filter (filter value is base64). */
export async function getSeriesItems(
  t: AbsTarget,
  libraryId: string,
  seriesId: string
): Promise<{ name: string; items: AbsListItem[] }> {
  const data = await absGet<{ results?: RawBareItem[] }>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/items?minified=1&limit=0&filter=series.${encodeURIComponent(b64(seriesId))}`
  )
  const items = (data.results ?? []).map(mapBareItem)
  return { name: '', items }
}

export interface AuthorDetail {
  id: string
  name: string
  description: string
  items: AbsListItem[]
}

/** An author with their books (expanded). */
export async function getAuthor(t: AbsTarget, authorId: string): Promise<AuthorDetail> {
  const data = await absGet<{
    id: string
    name?: string
    description?: string
    libraryItems?: RawBareItem[]
  }>(t, `/api/authors/${encodeURIComponent(authorId)}?include=items`)
  return {
    id: data.id,
    name: data.name || 'Unknown author',
    description: data.description || '',
    items: (data.libraryItems ?? []).map(mapBareItem),
  }
}

export interface CollectionSummary {
  id: string
  name: string
  itemCount: number
}

/** List collections in a library. */
export async function getCollections(
  t: AbsTarget,
  libraryId: string
): Promise<CollectionSummary[]> {
  const data = await absGet<{
    results?: Array<{ id: string; name: string; books?: unknown[] }>
  }>(t, `/api/libraries/${encodeURIComponent(libraryId)}/collections?limit=0`)
  return (data.results ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    itemCount: Array.isArray(c.books) ? c.books.length : 0,
  }))
}

export interface CollectionDetail {
  id: string
  name: string
  description: string
  items: AbsListItem[]
}

/** One collection with its items (expanded). */
export async function getCollection(t: AbsTarget, collectionId: string): Promise<CollectionDetail> {
  const data = await absGet<{
    id: string
    name?: string
    description?: string
    books?: RawBareItem[]
  }>(t, `/api/collections/${encodeURIComponent(collectionId)}`)
  return {
    id: data.id,
    name: data.name || 'Collection',
    description: data.description || '',
    items: (data.books ?? []).map(mapBareItem),
  }
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
  subtitle: string
  author: string
  authorId: string | null
  narrator: string
  genre: string
  publishedYear: string
  series: { id: string; name: string; sequence?: string } | null
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
      subtitle?: string
      authorName?: string
      authors?: Array<{ id: string; name: string }>
      narratorName?: string
      genres?: string[]
      publishedYear?: string
      series?: Array<{ id: string; name: string; sequence?: string }>
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
  const firstSeries = md?.series?.[0]
  return {
    id: r.id,
    title: md?.title || 'Untitled',
    subtitle: md?.subtitle || '',
    author: md?.authorName || '',
    authorId: md?.authors?.[0]?.id ?? null,
    narrator: md?.narratorName || '',
    genre: md?.genres?.[0] || '',
    publishedYear: md?.publishedYear || '',
    series: firstSeries ? { id: firstSeries.id, name: firstSeries.name, sequence: firstSeries.sequence } : null,
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

/** Mark an item finished or not finished. */
export async function setItemFinished(
  t: AbsTarget,
  itemId: string,
  finished: boolean
): Promise<void> {
  await absPatch(t, `/api/me/progress/${encodeURIComponent(itemId)}`, {
    isFinished: finished,
  })
}

// --- listening stats (/api/me/listening-stats) ------------------------------

export interface ListeningStats {
  /** All-time seconds listened. */
  totalTimeSec: number
  /** Seconds listened today. */
  todaySec: number
  /** Seconds per ISO date (YYYY-MM-DD), for the activity heatmap/streak. */
  byDay: Record<string, number>
}

interface RawListeningStats {
  totalTime?: number
  today?: number
  days?: Record<string, number>
}

export async function getListeningStats(t: AbsTarget): Promise<ListeningStats> {
  const data = await absGet<RawListeningStats>(t, '/api/me/listening-stats')
  return {
    totalTimeSec: data.totalTime ?? 0,
    todaySec: data.today ?? 0,
    byDay: data.days ?? {},
  }
}

// --- listening sessions (/api/me/listening-sessions) ------------------------

export interface ListeningSession {
  id: string
  itemId: string
  title: string
  author: string
  /** Seconds actually listened in this session. */
  timeListeningSec: number
  /** Epoch ms the session started. */
  startedAt: number
  device?: string
}

export interface ListeningSessionsPage {
  sessions: ListeningSession[]
  total: number
  page: number
  numPages: number
}

interface RawSession {
  id: string
  libraryItemId: string
  displayTitle: string
  displayAuthor: string
  timeListening: number
  startedAt: number
  deviceInfo?: { deviceName?: string; osName?: string; browserName?: string }
}

interface RawSessionsResponse {
  total: number
  numPages: number
  page: number
  sessions: RawSession[]
}

export async function getListeningSessions(
  t: AbsTarget,
  opts: { page?: number; itemsPerPage?: number } = {}
): Promise<ListeningSessionsPage> {
  const page = opts.page ?? 0
  const itemsPerPage = opts.itemsPerPage ?? 25
  const data = await absGet<RawSessionsResponse>(
    t,
    `/api/me/listening-sessions?page=${page}&itemsPerPage=${itemsPerPage}`
  )
  return {
    sessions: (data.sessions ?? []).map((s) => ({
      id: s.id,
      itemId: s.libraryItemId,
      title: s.displayTitle || 'Untitled',
      author: s.displayAuthor || '',
      timeListeningSec: s.timeListening ?? 0,
      startedAt: s.startedAt ?? 0,
      device:
        s.deviceInfo?.deviceName ||
        [s.deviceInfo?.osName, s.deviceInfo?.browserName].filter(Boolean).join(' ') ||
        undefined,
    })),
    total: data.total ?? 0,
    page: data.page ?? page,
    numPages: data.numPages ?? 1,
  }
}
