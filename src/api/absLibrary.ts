/**
 * Typed ABS library reads (libraries + items) over the direct ABS client.
 *
 * Field shapes verified against audiobookshelf 2.35.1 serializers. We use the
 * minified item form for lists (denormalized title/authorName, cover via the
 * item's /cover endpoint). Only the fields we render are typed.
 */
import { absGet, absPatch, absPost, absDelete, absMediaUrl, playDeviceInfo } from './absClient'
import { getAbsToken } from '@/lib/absTokens'
import type {
  ABSBookMetadata,
  ABSBookMedia,
  ABSLibraryItem,
  ABSLibraryFolder,
  ABSNarrator,
  ABSSeries,
  ABSLibraryAuthor,
  ABSItemMetadataPatch,
  ABSDeviceInfo,
} from '@hearthshelf/core'

export interface AbsTarget {
  serverId: string
  serverUrl: string
}

export interface AbsLibrary {
  id: string
  name: string
  mediaType: 'book' | 'podcast'
  icon: string
  /** On-disk roots, for targeting an upload at a specific folder. */
  folders: ABSLibraryFolder[]
}

interface RawLibrary {
  id: string
  name?: string
  mediaType?: 'book' | 'podcast'
  icon?: string
  folders?: ABSLibraryFolder[]
}

interface LibrariesResponse {
  libraries: RawLibrary[]
}

export async function getLibraries(t: AbsTarget): Promise<AbsLibrary[]> {
  const data = await absGet<LibrariesResponse>(t, '/api/libraries')
  return (data.libraries ?? []).map((l) => ({
    id: l.id,
    name: l.name ?? '',
    mediaType: l.mediaType ?? 'book',
    icon: l.icon ?? '',
    folders: l.folders ?? [],
  }))
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
    metadata?: { title?: string; authorName?: string; narratorName?: string }
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
  opts: { page?: number; limit?: number } = {},
): Promise<LibraryItemsPage> {
  const page = opts.page ?? 0
  const limit = opts.limit ?? 30
  const data = await absGet<LibraryItemsResponse>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/items?minified=1&limit=${limit}&page=${page}`,
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
  limit = 12,
): Promise<Shelf[]> {
  const raw = await absGet<RawShelf[]>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/personalized?limit=${limit}`,
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
  limit = 24,
): Promise<AbsListItem[]> {
  const q = query.trim()
  if (!q) return []
  const data = await absGet<SearchResponse>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/search?q=${encodeURIComponent(q)}&limit=${limit}`,
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

export interface SeriesSummary {
  id: string
  name: string
}

/** List the series in a library (for a series index). */
export async function getSeriesList(t: AbsTarget, libraryId: string): Promise<SeriesSummary[]> {
  const data = await absGet<{ results?: Array<{ id: string; name: string }> }>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/series?limit=0`,
  )
  return (data.results ?? []).map((s) => ({ id: s.id, name: s.name }))
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
  libraryId: string,
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
  /** The open play session's id - sync/close it to accrue listening time + a
   *  session record. Null when no session opened (e.g. a book with no audio). */
  playSessionId: string | null
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
    chapters?: RawChapter[]
  }
  userMediaProgress?: { currentTime?: number; isFinished?: boolean } | null
}

// The play session ABS returns from POST /api/items/:id/play. This is the ONLY
// endpoint that yields streamable audio tracks (contentUrl + startOffset) and the
// authoritative book duration / resume position - the item endpoint does NOT
// return media.tracks or a usable media.duration on an expanded read.
interface RawPlaySession {
  id?: string
  duration?: number
  currentTime?: number
  chapters?: RawChapter[]
  audioTracks?: Array<{
    index: number
    contentUrl: string
    startOffset?: number
    duration?: number
  }>
}

/**
 * Report listened time to an open play session. THIS is what makes ABS count
 * listening time and create a session record (the stateless progress PATCH only
 * moves the resume point - it never accrues stats/sessions). Best-effort.
 */
export async function syncPlaySession(
  t: AbsTarget,
  sessionId: string,
  currentTimeSec: number,
  timeListenedSec: number,
  durationSec: number,
): Promise<void> {
  await absPost(t, `/api/session/${encodeURIComponent(sessionId)}/sync`, {
    currentTime: currentTimeSec,
    timeListened: timeListenedSec,
    duration: durationSec,
  }).catch(() => {})
}

/** Close an open play session (on stop / unmount). Best-effort. */
export async function closePlaySession(
  t: AbsTarget,
  sessionId: string,
  currentTimeSec: number,
  timeListenedSec: number,
  durationSec: number,
): Promise<void> {
  await absPost(t, `/api/session/${encodeURIComponent(sessionId)}/close`, {
    currentTime: currentTimeSec,
    timeListened: timeListenedSec,
    duration: durationSec,
  }).catch(() => {})
}

const PLAY_MIME = ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/flac', 'audio/ogg']

export async function getItemDetail(t: AbsTarget, itemId: string): Promise<AbsItemDetail> {
  // Metadata comes from the item endpoint; playable tracks + true duration come
  // from a play session (ABS only exposes streamable tracks there).
  const [r, session] = await Promise.all([
    absGet<RawItemDetail>(
      t,
      `/api/items/${encodeURIComponent(itemId)}?expanded=1&include=progress`,
    ),
    absPost<RawPlaySession>(t, `/api/items/${encodeURIComponent(itemId)}/play`, {
      deviceInfo: playDeviceInfo(),
      supportedMimeTypes: PLAY_MIME,
    }).catch(() => null),
  ])
  const md = r.media?.metadata
  const tracks: AbsTrack[] = (session?.audioTracks ?? []).map((tr) => ({
    ino: String(tr.index),
    index: tr.index,
    startOffsetSec: tr.startOffset ?? 0,
    durationSec: tr.duration ?? 0,
    // contentUrl is "/api/items/{id}/file/{ino}"; add the auth token for <audio>.
    url: absMediaUrl(t, tr.contentUrl),
  }))
  // Prefer the session's chapters/duration (authoritative); fall back to the
  // item endpoint's chapters when no session (e.g. a book with no audio).
  const rawChapters = session?.chapters ?? r.media?.chapters ?? []
  const durationSec = session?.duration ?? tracks.reduce((s, tr) => s + tr.durationSec, 0)
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
    series: firstSeries
      ? { id: firstSeries.id, name: firstSeries.name, sequence: firstSeries.sequence }
      : null,
    description: md?.description || '',
    durationSec,
    coverUrl: itemCoverUrl(t, r.id, 480),
    tracks,
    chapters: rawChapters.map((c) => ({
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
      : session?.currentTime != null
        ? { currentTimeSec: session.currentTime, isFinished: false }
        : null,
    playSessionId: session?.id ?? null,
  }
}

/** Save listening progress (stateless; no play session needed). */
export async function saveProgress(
  t: AbsTarget,
  itemId: string,
  currentTimeSec: number,
  durationSec: number,
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
  finished: boolean,
): Promise<void> {
  await absPatch(t, `/api/me/progress/${encodeURIComponent(itemId)}`, {
    isFinished: finished,
  })
}

// --- bulk media progress (/api/me -> mediaProgress[]) -----------------------

/** One item's listening progress, as ABS returns it in /api/me. */
export interface MediaProgress {
  libraryItemId: string
  duration: number
  /** 0..1 fraction complete. */
  progress: number
  currentTime: number
  isFinished: boolean
}

interface RawMeResponse {
  mediaProgress?: Array<{
    libraryItemId: string
    duration?: number
    progress?: number
    currentTime?: number
    isFinished?: boolean
  }>
}

/**
 * The user's full per-item progress list, for building a libraryItemId -> progress
 * lookup (tiles, shelves, detail pages). One /api/me call covers the whole library.
 */
export async function getMediaProgress(t: AbsTarget): Promise<MediaProgress[]> {
  const data = await absGet<RawMeResponse>(t, '/api/me')
  return (data.mediaProgress ?? []).map((p) => ({
    libraryItemId: p.libraryItemId,
    duration: p.duration ?? 0,
    progress: p.progress ?? 0,
    currentTime: p.currentTime ?? 0,
    isFinished: Boolean(p.isFinished),
  }))
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
  /** Raw ABS device fields, for classifying the session's origin. */
  deviceInfo?: ABSDeviceInfo
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
  deviceInfo?: ABSDeviceInfo
}

interface RawSessionsResponse {
  total: number
  numPages: number
  page: number
  sessions: RawSession[]
}

export async function getListeningSessions(
  t: AbsTarget,
  opts: { page?: number; itemsPerPage?: number } = {},
): Promise<ListeningSessionsPage> {
  const page = opts.page ?? 0
  const itemsPerPage = opts.itemsPerPage ?? 25
  const data = await absGet<RawSessionsResponse>(
    t,
    `/api/me/listening-sessions?page=${page}&itemsPerPage=${itemsPerPage}`,
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
      deviceInfo: s.deviceInfo,
    })),
    total: data.total ?? 0,
    page: data.page ?? page,
    numPages: data.numPages ?? 1,
  }
}

// --- narrators (people view) ------------------------------------------------

/** A narrator summary as returned by ABS's library narrators endpoint. */
export type AbsNarrator = ABSNarrator

interface NarratorsResponse {
  narrators?: AbsNarrator[]
}

/**
 * List the narrators in a library. ABS derives these from item metadata (they
 * are not first-class records), giving each a synthetic id, the display name,
 * and how many books credit them.
 */
export async function getNarrators(t: AbsTarget, libraryId: string): Promise<AbsNarrator[]> {
  const data = await absGet<NarratorsResponse>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/narrators`,
  )
  return (data.narrators ?? []).map((n) => ({
    id: n.id,
    name: n.name,
    numBooks: n.numBooks ?? 0,
  }))
}

/**
 * A library item carrying the fields the narrators view needs to build a
 * narrator -> books map. Extends the list shape with the raw narrator credit
 * string (comma-joined names) ABS stores on each item's metadata.
 */
export interface AbsNarratorItem extends AbsListItem {
  /** Raw narrator credit string ("Name A, Name B"), empty when uncredited. */
  narrator: string
}

/**
 * Fetch every item in a library (limit=0) with its narrator credit, for
 * building the narrator -> books map the people view renders. Mirrors the
 * minified list shape but keeps narratorName so callers can group by narrator.
 */
export async function getAllLibraryItems(
  t: AbsTarget,
  libraryId: string,
): Promise<AbsNarratorItem[]> {
  const data = await absGet<{ results?: RawListItem[] }>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/items?minified=1&limit=0`,
  )
  return (data.results ?? []).map((r) => ({
    id: r.id,
    title: r.media?.metadata?.title || 'Untitled',
    author: r.media?.metadata?.authorName || '',
    mediaType: r.mediaType,
    durationSec: r.media?.duration ?? 0,
    narrator: r.media?.metadata?.narratorName || '',
  }))
}

/**
 * Rename a narrator across a whole library. Narrators are item string fields,
 * not first-class records, so ABS exposes a bulk-rename route that rewrites the
 * credit on every item. Renaming one narrator to another's name merges them;
 * renaming to "Unknown" effectively strips the credit. Admin only.
 */
export async function renameNarrator(
  t: AbsTarget,
  libraryId: string,
  oldName: string,
  newName: string,
): Promise<void> {
  await absPatch(t, `/api/libraries/${encodeURIComponent(libraryId)}/narrators`, {
    oldName,
    newName,
  })
}

// =============================================================================
// Rich library item shape + browse APIs for the full Library page.
//
// The Library page filters/sorts/derives client-side over the whole library, so
// it needs more than the minified list shape above. These mirror the self-hosted
// ABS reads (libraries.ts / admin.ts) over the WebApp's direct ABS client.
// Verified against audiobookshelf 2.35.1 serializers.
// =============================================================================

export type ItemMetadataPatch = ABSItemMetadataPatch

// These shapes are now owned by @hearthshelf/core (canonical ABS types). The
// local Abs* aliases stay so existing importers keep resolving; they will be
// renamed to the ABS* names in a follow-up pass.
export type AbsItemMetadata = ABSBookMetadata
export type AbsItemMedia = ABSBookMedia
export type AbsLibraryItem = ABSLibraryItem

interface RawFullMetadata {
  title?: string | null
  titleIgnorePrefix?: string
  subtitle?: string | null
  authorName?: string
  narratorName?: string
  seriesName?: string
  publishedYear?: string | null
  description?: string | null
  genres?: string[]
  language?: string | null
  explicit?: boolean
}

interface RawFullItem {
  id: string
  libraryId?: string
  folderId?: string
  path?: string
  mediaType?: 'book' | 'podcast'
  addedAt?: number
  updatedAt?: number
  isMissing?: boolean
  isInvalid?: boolean
  media?: {
    id?: string
    metadata?: RawFullMetadata
    coverPath?: string | null
    tags?: string[]
    numTracks?: number
    numAudioFiles?: number
    numChapters?: number
    duration?: number
    size?: number
    ebookFormat?: string
  }
}

function mapFullItem(r: RawFullItem): AbsLibraryItem {
  const md = r.media?.metadata ?? {}
  return {
    id: r.id,
    libraryId: r.libraryId ?? '',
    folderId: r.folderId ?? '',
    path: r.path ?? '',
    mediaType: r.mediaType ?? 'book',
    addedAt: r.addedAt ?? 0,
    updatedAt: r.updatedAt ?? 0,
    isMissing: Boolean(r.isMissing),
    isInvalid: Boolean(r.isInvalid),
    media: {
      id: r.media?.id ?? '',
      metadata: {
        title: md.title ?? null,
        titleIgnorePrefix: md.titleIgnorePrefix ?? md.title ?? '',
        subtitle: md.subtitle ?? null,
        authorName: md.authorName ?? '',
        narratorName: md.narratorName ?? '',
        seriesName: md.seriesName ?? '',
        publishedYear: md.publishedYear ?? null,
        description: md.description ?? null,
        genres: md.genres ?? [],
        language: md.language ?? null,
        explicit: Boolean(md.explicit),
      },
      coverPath: r.media?.coverPath ?? null,
      tags: r.media?.tags ?? [],
      numTracks: r.media?.numTracks ?? 0,
      numAudioFiles: r.media?.numAudioFiles ?? 0,
      numChapters: r.media?.numChapters ?? 0,
      duration: r.media?.duration ?? 0,
      size: r.media?.size ?? 0,
      ebookFormat: r.media?.ebookFormat,
    },
  }
}

export interface LibraryItemsFull {
  results: AbsLibraryItem[]
  total: number
}

/**
 * Fetch the entire library in one request (ABS treats limit=0 as "no limit").
 * The Library page filters/sorts/derives client-side over the full set.
 */
export async function getAllLibraryItemsFull(
  t: AbsTarget,
  libraryId: string,
): Promise<LibraryItemsFull> {
  const data = await absGet<{ results?: RawFullItem[]; total?: number }>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/items?minified=1&limit=0`,
  )
  const results = (data.results ?? []).map(mapFullItem)
  return { results, total: data.total ?? results.length }
}

// --- Series (with book counts + cover items) --------------------------------

export type AbsSeries = ABSSeries

export interface SeriesListResponse {
  results: AbsSeries[]
  total: number
}

/** List the series in a library with their books (for the Series tab cards). */
export async function getSeries(
  t: AbsTarget,
  libraryId: string,
  page = 0,
  limit = 1000,
): Promise<SeriesListResponse> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sort: 'name',
  })
  const data = await absGet<{
    results?: Array<{
      id: string
      name?: string
      nameIgnorePrefix?: string
      description?: string | null
      books?: RawFullItem[]
    }>
    total?: number
  }>(t, `/api/libraries/${encodeURIComponent(libraryId)}/series?${params.toString()}`)
  const results: AbsSeries[] = (data.results ?? []).map((s) => ({
    id: s.id,
    name: s.name ?? '',
    nameIgnorePrefix: s.nameIgnorePrefix ?? s.name ?? '',
    description: s.description ?? null,
    books: (s.books ?? []).map(mapFullItem),
  }))
  return { results, total: data.total ?? results.length }
}

// --- Authors (library author list: id, name, image, book count) -------------

export type AbsLibraryAuthor = ABSLibraryAuthor

export interface AuthorsResponse {
  authors: AbsLibraryAuthor[]
}

/** List the authors in a library (id -> name map + photos for cards). */
export async function getAuthors(t: AbsTarget, libraryId: string): Promise<AuthorsResponse> {
  const data = await absGet<{
    authors?: Array<{
      id: string
      name?: string
      description?: string | null
      imagePath?: string | null
      numBooks?: number
      addedAt?: number
    }>
  }>(t, `/api/libraries/${encodeURIComponent(libraryId)}/authors`)
  return {
    authors: (data.authors ?? []).map((a) => ({
      id: a.id,
      name: a.name ?? '',
      description: a.description ?? null,
      imagePath: a.imagePath ?? null,
      numBooks: a.numBooks ?? 0,
      addedAt: a.addedAt ?? 0,
    })),
  }
}

/**
 * Update an author's editable fields. ABS auto-merges when the new name matches
 * another author in the same library. `imageUrl` makes ABS download and store a
 * photo from the web; `asin` links the Audible identity.
 */
export async function updateAuthor(
  t: AbsTarget,
  authorId: string,
  patch: { name?: string; description?: string; asin?: string; imageUrl?: string },
): Promise<void> {
  await absPatch(t, `/api/authors/${encodeURIComponent(authorId)}`, patch)
}

/**
 * Quick-match an author against the metadata provider (Audible) by name - the
 * "+1" match in ABS. ABS fetches the author's photo, bio, and ASIN and stores
 * them server-side. Returns whether anything was updated + the new imagePath.
 */
export async function matchAuthor(
  t: AbsTarget,
  authorId: string,
  name: string,
  region = 'us',
): Promise<{ updated: boolean; imagePath: string | null }> {
  const res = await absPost<{ updated?: boolean; author?: { imagePath?: string | null } }>(
    t,
    `/api/authors/${encodeURIComponent(authorId)}/match`,
    { q: name, region },
  )
  return { updated: Boolean(res?.updated), imagePath: res?.author?.imagePath ?? null }
}

/**
 * Remove an author record. ABS strips the author credit from each item's
 * metadata but keeps the books and their audio files.
 */
export async function deleteAuthor(t: AbsTarget, authorId: string): Promise<void> {
  await absDelete(t, `/api/authors/${encodeURIComponent(authorId)}`)
}

/**
 * Upload a local image file as an author's photo (multipart). absPost only does
 * JSON, so this posts FormData directly to the server origin with the per-server
 * bearer token - the same pattern the Upload page uses.
 */
export async function uploadAuthorImage(t: AbsTarget, authorId: string, file: File): Promise<void> {
  const form = new FormData()
  form.append('file', file)
  const token = getAbsToken(t.serverId)
  const res = await fetch(
    `${t.serverUrl.replace(/\/$/, '')}/api/authors/${encodeURIComponent(authorId)}/image`,
    {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    },
  )
  if (!res.ok) throw new Error(`author image upload failed (${res.status})`)
}

// --- Batch item actions (admin / write) -------------------------------------

export interface BatchMediaPayload {
  metadata?: ItemMetadataPatch
  tags?: string[]
}

/** Write the same media payload across many items at once. */
export async function batchUpdateItems(
  t: AbsTarget,
  ids: string[],
  mediaPayload: BatchMediaPayload,
): Promise<void> {
  await absPost(
    t,
    '/api/items/batch/update',
    ids.map((id) => ({ id, mediaPayload })),
  )
}

export async function batchDeleteItems(t: AbsTarget, libraryItemIds: string[]): Promise<void> {
  await absPost(t, '/api/items/batch/delete', { libraryItemIds })
}

export async function batchScanItems(t: AbsTarget, libraryItemIds: string[]): Promise<void> {
  await absPost(t, '/api/items/batch/scan', { libraryItemIds })
}

export async function batchQuickMatchItems(
  t: AbsTarget,
  libraryItemIds: string[],
  options: { provider?: string; overrideDetails?: boolean } = {},
): Promise<void> {
  await absPost(t, '/api/items/batch/quickmatch', { libraryItemIds, options })
}

/**
 * Tokenized URL to zip-download several items at once (ABS takes a comma-joined
 * ?ids= list). Null when there's no token yet.
 */
export function libraryDownloadUrl(
  t: AbsTarget,
  libraryId: string,
  itemIds: string[],
): string | null {
  return absMediaUrl(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/download?ids=${encodeURIComponent(
      itemIds.join(','),
    )}`,
  )
}

// --- Collections / playlists (Add to list…) ---------------------------------

export interface AbsListSummary {
  id: string
  name: string
}

export async function getCollectionsList(
  t: AbsTarget,
  libraryId: string,
): Promise<AbsListSummary[]> {
  const data = await absGet<{ results?: Array<{ id: string; name?: string }> }>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/collections`,
  )
  return (data.results ?? []).map((c) => ({ id: c.id, name: c.name ?? 'Collection' }))
}

export async function getPlaylistsList(t: AbsTarget, libraryId: string): Promise<AbsListSummary[]> {
  const data = await absGet<{ results?: Array<{ id: string; name?: string }> }>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/playlists`,
  )
  return (data.results ?? []).map((p) => ({ id: p.id, name: p.name ?? 'Playlist' }))
}

export async function createCollection(
  t: AbsTarget,
  libraryId: string,
  name: string,
  books: string[],
): Promise<void> {
  await absPost(t, '/api/collections', { libraryId, name, books })
}

export async function addBookToCollection(
  t: AbsTarget,
  collectionId: string,
  libraryItemId: string,
): Promise<void> {
  await absPost(t, `/api/collections/${encodeURIComponent(collectionId)}/book`, {
    id: libraryItemId,
  })
}

export async function addBooksToCollection(
  t: AbsTarget,
  collectionId: string,
  libraryItemIds: string[],
): Promise<void> {
  await absPost(t, `/api/collections/${encodeURIComponent(collectionId)}/batch/add`, {
    books: libraryItemIds,
  })
}

export async function createPlaylist(
  t: AbsTarget,
  libraryId: string,
  name: string,
  items: { libraryItemId: string; episodeId?: string }[],
): Promise<void> {
  await absPost(t, '/api/playlists', { libraryId, name, items })
}

export async function addItemToPlaylist(
  t: AbsTarget,
  playlistId: string,
  libraryItemId: string,
): Promise<void> {
  await absPost(t, `/api/playlists/${encodeURIComponent(playlistId)}/item`, {
    libraryItemId,
  })
}

export async function addBooksToPlaylist(
  t: AbsTarget,
  playlistId: string,
  libraryItemIds: string[],
): Promise<void> {
  await absPost(t, `/api/playlists/${encodeURIComponent(playlistId)}/batch/add`, {
    items: libraryItemIds.map((libraryItemId) => ({ libraryItemId })),
  })
}

// --- Current user (admin gating) --------------------------------------------

export interface AbsMe {
  id: string
  username: string
  type: string
  permissions: { update: boolean; delete: boolean; download: boolean; upload: boolean } | null
}

/** The signed-in user on the active server, for gating admin batch actions. */
export async function getMe(t: AbsTarget): Promise<AbsMe> {
  const data = await absGet<{
    id?: string
    username?: string
    type?: string
    permissions?: { update?: boolean; delete?: boolean; download?: boolean; upload?: boolean }
  }>(t, '/api/me')
  return {
    id: data.id ?? '',
    username: data.username ?? '',
    type: data.type ?? 'user',
    permissions: data.permissions
      ? {
          update: Boolean(data.permissions.update),
          delete: Boolean(data.permissions.delete),
          download: Boolean(data.permissions.download),
          upload: Boolean(data.permissions.upload),
        }
      : null,
  }
}
