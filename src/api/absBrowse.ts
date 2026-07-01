/**
 * Richer browse reads for the full Author / Series detail pages.
 *
 * The minified list reads in absLibrary.ts (getAuthor / getSeries) drop fields
 * these pages need - the author's photo + bio, and the full per-book item shape
 * (AbsLibraryItem) that BookTile / BookContextMenu render. These wrappers hit the
 * expanded ABS endpoints and return the full shapes.
 *
 * Field shapes verified against audiobookshelf 2.35.1 serializers and mirror the
 * self-hosted reads (HearthShelf src/api/libraries.ts getAuthor / getOneSeries).
 */
import { absGet } from './absClient'
import { getSeries, type AbsTarget, type AbsLibraryItem, type AbsSeries } from './absLibrary'

// Raw full library item, as ABS returns it inside an author's libraryItems[] (or
// a series' books[]). Only the fields we render are typed; mapper fills the rest.
interface RawAuthorItem {
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
    metadata?: {
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

function mapAuthorItem(r: RawAuthorItem): AbsLibraryItem {
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

/** A full author record: photo + bio + their books as full library items. */
export interface AuthorFull {
  id: string
  name: string
  description: string
  imagePath: string | null
  books: AbsLibraryItem[]
}

/**
 * One author with their books, expanded. Unlike getAuthor (minified list shape),
 * this keeps imagePath (for the avatar photo) and returns full AbsLibraryItem
 * books so BookTile can render progress + ebook badges.
 */
export async function getAuthorFull(t: AbsTarget, authorId: string): Promise<AuthorFull> {
  const data = await absGet<{
    id: string
    name?: string
    description?: string | null
    imagePath?: string | null
    libraryItems?: RawAuthorItem[]
  }>(t, `/api/authors/${encodeURIComponent(authorId)}?include=items`)
  return {
    id: data.id,
    name: data.name || 'Unknown author',
    description: data.description || '',
    imagePath: data.imagePath ?? null,
    books: (data.libraryItems ?? []).map(mapAuthorItem),
  }
}

/**
 * One series with its books as full library items. ABS has no clean
 * single-series-by-id route, so this reads the library's series list (each
 * series carries its books) and picks the one we want - same approach as the
 * self-hosted getOneSeries. Returns null when the series isn't found.
 */
export async function getSeriesFull(
  t: AbsTarget,
  libraryId: string,
  seriesId: string,
): Promise<AbsSeries | null> {
  const res = await getSeries(t, libraryId, 0, 1000)
  return res.results.find((s) => s.id === seriesId) ?? null
}
