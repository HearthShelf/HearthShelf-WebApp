/**
 * Home + Search reads that the thin absLibrary client didn't cover.
 *
 * Two things live here so absLibrary.ts stays untouched:
 *  - getItemsInProgress: the user's "continue listening" list straight from
 *    ABS (/api/me/items-in-progress), as full library items.
 *  - searchLibraryFull: the multi-section search ABS already returns from one
 *    /search call (books, series, authors, narrators), which the minified
 *    searchLibrary in absLibrary.ts flattens away.
 *
 * Both reuse the rich AbsLibraryItem / AbsSeries shapes from absLibrary so tiles,
 * series cards, and progress joins work the same as elsewhere. Field shapes
 * verified against audiobookshelf 2.35.1 serializers.
 */
import { absGet } from './absClient'
import type { AbsTarget, AbsLibraryItem, AbsSeries } from './absLibrary'

// --- raw -> rich item mapping (mirrors absLibrary.mapFullItem, kept local) ----

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

// --- personalized home shelves (rich, type-preserving) ----------------------

interface RawSeries {
  id?: string
  name?: string
  nameIgnorePrefix?: string
  description?: string | null
  books?: RawFullItem[]
}

interface RawPersonalizedShelf {
  id: string
  label: string
  type?: string
  entities?: Array<RawFullItem | RawSeries>
}

/** A book shelf with full library items (cover, progress, ebook badge, etc.). */
export interface BookShelf {
  id: string
  label: string
  type: 'book'
  items: AbsLibraryItem[]
}

/** A series shelf with full series cards. */
export interface SeriesShelf {
  id: string
  label: string
  type: 'series'
  series: AbsSeries[]
}

export type HomeShelf = BookShelf | SeriesShelf

function mapSeries(r: RawSeries): AbsSeries {
  return {
    id: r.id ?? '',
    name: r.name ?? '',
    nameIgnorePrefix: r.nameIgnorePrefix ?? r.name ?? '',
    description: r.description ?? null,
    books: (r.books ?? []).map(mapFullItem),
  }
}

/**
 * Personalized home shelves for one library, keeping ABS's shelf `type` so the
 * home page can render book shelves (BookTile) and series shelves (SeriesCard)
 * distinctly. Only book + series shelves are surfaced; other types are dropped.
 */
export async function getHomeShelves(
  t: AbsTarget,
  libraryId: string,
  limit = 12,
): Promise<HomeShelf[]> {
  const raw = await absGet<RawPersonalizedShelf[]>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/personalized?limit=${limit}`,
  )
  const out: HomeShelf[] = []
  for (const sh of raw ?? []) {
    if (sh.type === 'series') {
      out.push({
        id: sh.id,
        label: sh.label,
        type: 'series',
        series: (sh.entities ?? []).map((e) => mapSeries(e as RawSeries)),
      })
    } else if (sh.type === 'book' || sh.type === undefined) {
      out.push({
        id: sh.id,
        label: sh.label,
        type: 'book',
        items: (sh.entities ?? []).map((e) => mapFullItem(e as RawFullItem)),
      })
    }
  }
  return out
}

// --- unified home: merge shelves across every library -----------------------

// Shelf ids whose items are time-ordered (newest first). When we concat the
// same shelf from several libraries the per-library ordering is lost, so these
// get re-sorted by addedAt after merging; everything else keeps library order.
const RECENCY_SHELVES = new Set(['recently-added', 'listen-again'])

/**
 * Fold the per-library home shelves into one set of shelves "across all
 * libraries". Shelves are matched by id (e.g. every library's "recently-added"
 * becomes one shelf), their entities concatenated and de-duplicated by item /
 * series id. Recency shelves are re-sorted by addedAt (newest first) so the
 * merged shelf still reads newest-first across libraries; other shelves keep the
 * order the libraries returned. Shelf order follows first appearance.
 */
export function mergeHomeShelves(perLibrary: HomeShelf[][]): HomeShelf[] {
  const order: string[] = []
  const byId = new Map<string, HomeShelf>()

  for (const shelves of perLibrary) {
    for (const sh of shelves) {
      const existing = byId.get(sh.id)
      if (!existing) {
        order.push(sh.id)
        // Clone so we don't mutate the per-library query cache.
        byId.set(
          sh.id,
          sh.type === 'series'
            ? { ...sh, series: [...sh.series] }
            : { ...sh, items: [...sh.items] },
        )
        continue
      }
      if (existing.type === 'series' && sh.type === 'series') {
        existing.series.push(...sh.series)
      } else if (existing.type === 'book' && sh.type === 'book') {
        existing.items.push(...sh.items)
      }
    }
  }

  const out: HomeShelf[] = []
  for (const id of order) {
    const sh = byId.get(id)
    if (!sh) continue
    if (sh.type === 'series') {
      out.push({ ...sh, series: dedupeById(sh.series) })
    } else {
      let items = dedupeById(sh.items)
      if (RECENCY_SHELVES.has(sh.id)) {
        items = [...items].sort((a, b) => b.addedAt - a.addedAt)
      }
      out.push({ ...sh, items })
    }
  }
  return out
}

function dedupeById<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const x of list) {
    if (x.id && seen.has(x.id)) continue
    if (x.id) seen.add(x.id)
    out.push(x)
  }
  return out
}

// --- continue listening (/api/me/items-in-progress) -------------------------

interface ItemsInProgressResponse {
  libraryItems?: RawFullItem[]
}

/**
 * The user's in-progress books across the active server, newest activity first
 * (ABS's own ordering). Optionally narrow to one library. Returns full library
 * items so the home hero + shelf render the same tiles as everywhere else.
 */
export async function getItemsInProgress(
  t: AbsTarget,
  libraryId?: string,
): Promise<AbsLibraryItem[]> {
  const data = await absGet<ItemsInProgressResponse>(t, '/api/me/items-in-progress')
  const items = (data.libraryItems ?? []).map(mapFullItem)
  return libraryId ? items.filter((i) => i.libraryId === '' || i.libraryId === libraryId) : items
}

// --- multi-section search (/search) -----------------------------------------

export interface SearchAuthor {
  id: string
  name: string
  numBooks: number
}

export interface SearchNarrator {
  name: string
  numBooks: number
}

export interface SearchSeriesGroup {
  id: string
  name: string
  books: AbsLibraryItem[]
}

export interface LibrarySearchResults {
  books: AbsLibraryItem[]
  series: SearchSeriesGroup[]
  authors: SearchAuthor[]
  narrators: SearchNarrator[]
}

interface RawSearchResponse {
  book?: Array<{ libraryItem?: RawFullItem }>
  series?: Array<{
    series?: { id?: string; name?: string }
    books?: RawFullItem[]
  }>
  authors?: Array<{ id?: string; name?: string; numBooks?: number }>
  narrators?: Array<{ name?: string; numBooks?: number }>
}

/**
 * Search a library and keep ALL the groups ABS returns from one call: matching
 * books, series (each with its hit books), authors, and narrators. The minified
 * searchLibrary in absLibrary.ts only surfaces books; this keeps the rest for the
 * Search page's multi-section layout. Empty query returns nothing without hitting
 * the server (ABS 400s on an empty q).
 */
export async function searchLibraryFull(
  t: AbsTarget,
  libraryId: string,
  query: string,
  limit = 24,
): Promise<LibrarySearchResults> {
  const q = query.trim()
  if (!q) return { books: [], series: [], authors: [], narrators: [] }
  const data = await absGet<RawSearchResponse>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  )
  const books = (data.book ?? [])
    .map((e) => e.libraryItem)
    .filter((i): i is RawFullItem => Boolean(i))
    .map(mapFullItem)
  const series: SearchSeriesGroup[] = (data.series ?? []).map((s) => ({
    id: s.series?.id ?? '',
    name: s.series?.name ?? '',
    books: (s.books ?? []).map(mapFullItem),
  }))
  const authors: SearchAuthor[] = (data.authors ?? []).map((a) => ({
    id: a.id ?? '',
    name: a.name ?? '',
    numBooks: a.numBooks ?? 0,
  }))
  const narrators: SearchNarrator[] = (data.narrators ?? []).map((n) => ({
    name: n.name ?? '',
    numBooks: n.numBooks ?? 0,
  }))
  return { books, series, authors, narrators }
}

/** A series group shaped as the shared SeriesCard's AbsSeries, for reuse. */
export function searchSeriesToCard(g: SearchSeriesGroup): AbsSeries {
  return {
    id: g.id,
    name: g.name,
    nameIgnorePrefix: g.name,
    description: null,
    books: g.books,
  }
}
