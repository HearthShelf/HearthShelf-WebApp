/**
 * Rich single-item read for the full Book Detail page.
 *
 * `getItemDetail` in absLibrary.ts returns the lean shape the player needs
 * (tracks/chapters/progress). The detail page renders more: rating, ISBN/ASIN
 * (for external deep links), per-file audio metadata (codec/bitrate/size), the
 * ebook file, tags, and admin gating. Rather than widen the shared loader, this
 * fetches the same expanded item and surfaces the extra fields.
 *
 * Shapes verified against HearthShelf's ABSLibraryItemDetail (audiobookshelf
 * 2.35.1 expanded item: /api/items/:id?expanded=1). Only fields we render are
 * typed; ABS returns more.
 */
import { absGet, absPatch, absPost, absDelete, absMediaUrl } from './absClient'
import type { AbsTarget } from './absLibrary'

export interface BookAudioFile {
  ino: string
  index: number
  codec: string
  bitRate: number | null
  durationSec: number
  filename: string
  size: number
}

export interface BookEbookFile {
  ino: string
  format: string
  filename: string
  size: number | null
}

export interface BookSeriesRef {
  id: string
  name: string
  sequence: string | null
}

/** The extra metadata the full detail page renders on top of the player shape. */
export interface BookDetailFull {
  id: string
  libraryId: string
  title: string
  subtitle: string
  author: string
  authorId: string | null
  narrator: string
  genres: string[]
  tags: string[]
  publishedYear: string
  publisher: string
  isbn: string | null
  asin: string | null
  rating: number | null
  abridged: boolean
  series: BookSeriesRef | null
  description: string
  durationSec: number
  audioFiles: BookAudioFile[]
  ebookFormat: string | null
  ebookFile: BookEbookFile | null
}

interface RawAudioFile {
  ino: string
  index: number
  codec?: string
  bitRate?: number
  duration?: number
  metadata?: { filename?: string; ext?: string; size?: number }
}

interface RawEbookFile {
  ino: string
  ebookFormat?: string
  metadata?: { filename?: string; ext?: string; size?: number }
}

interface RawDetailMetadata {
  title?: string
  subtitle?: string
  authorName?: string
  authors?: Array<{ id: string; name: string }>
  narratorName?: string
  narrators?: string[]
  genres?: string[]
  publishedYear?: string
  publisher?: string
  isbn?: string | null
  asin?: string | null
  rating?: number | null
  abridged?: boolean
  series?: Array<{ id: string; name: string; sequence?: string | null }>
  description?: string
}

interface RawDetailItem {
  id: string
  libraryId?: string
  media?: {
    duration?: number
    metadata?: RawDetailMetadata
    audioFiles?: RawAudioFile[]
    ebookFile?: RawEbookFile | null
    ebookFormat?: string
    tags?: string[]
  }
}

/**
 * Fetch the expanded item and surface the full detail shape. One request covers
 * both the player needs (loaded separately) and these richer fields.
 */
export async function getBookDetailFull(t: AbsTarget, itemId: string): Promise<BookDetailFull> {
  const r = await absGet<RawDetailItem>(
    t,
    `/api/items/${encodeURIComponent(itemId)}?expanded=1`
  )
  const md = r.media?.metadata ?? {}
  const firstSeries = md.series?.[0]
  const audioFiles: BookAudioFile[] = (r.media?.audioFiles ?? []).map((f) => ({
    ino: f.ino,
    index: f.index,
    codec: f.codec ?? '',
    bitRate: f.bitRate ?? null,
    durationSec: f.duration ?? 0,
    filename: f.metadata?.filename ?? '',
    size: f.metadata?.size ?? 0,
  }))
  const ebookFile: BookEbookFile | null = r.media?.ebookFile
    ? {
        ino: r.media.ebookFile.ino,
        format: r.media.ebookFile.ebookFormat ?? r.media?.ebookFormat ?? '',
        filename: r.media.ebookFile.metadata?.filename ?? 'ebook',
        size: r.media.ebookFile.metadata?.size ?? null,
      }
    : null
  return {
    id: r.id,
    libraryId: r.libraryId ?? '',
    title: md.title || 'Untitled',
    subtitle: md.subtitle || '',
    author: md.authorName || md.authors?.[0]?.name || '',
    authorId: md.authors?.[0]?.id ?? null,
    narrator: md.narratorName || md.narrators?.[0] || '',
    genres: md.genres ?? [],
    tags: r.media?.tags ?? [],
    publishedYear: md.publishedYear || '',
    publisher: md.publisher || '',
    isbn: md.isbn ?? null,
    asin: md.asin ?? null,
    rating: md.rating ?? null,
    abridged: Boolean(md.abridged),
    series: firstSeries
      ? { id: firstSeries.id, name: firstSeries.name, sequence: firstSeries.sequence ?? null }
      : null,
    description: md.description || '',
    durationSec: r.media?.duration ?? 0,
    audioFiles,
    ebookFormat: r.media?.ebookFormat ?? ebookFile?.format ?? null,
    ebookFile,
  }
}

/**
 * Tokenized URL to download one of an item's files (cover, audio, ebook) by ino.
 * Null when there's no token yet. The token rides as ?token= since anchor
 * downloads can't set an Authorization header.
 */
export function itemFileDownloadUrl(t: AbsTarget, itemId: string, ino: string): string | null {
  return absMediaUrl(t, `/api/items/${encodeURIComponent(itemId)}/file/${encodeURIComponent(ino)}/download`)
}

/** Tokenized URL to download the whole item as a zip. Null without a token. */
export function itemDownloadUrl(t: AbsTarget, itemId: string): string | null {
  return absMediaUrl(t, `/api/items/${encodeURIComponent(itemId)}/download`)
}

/** Tokenized full-size cover URL for the zoom viewer. Null without a token. */
export function itemCoverFullUrl(t: AbsTarget, itemId: string): string | null {
  return absMediaUrl(t, `/api/items/${encodeURIComponent(itemId)}/cover`)
}

// --- admin writes (item metadata, chapters, files, tools) -------------------

/** Editable metadata fields on an item's media (PATCH /api/items/:id/media). */
export interface ItemMetadataPatch {
  title?: string | null
  subtitle?: string | null
  description?: string | null
  publishedYear?: string | null
  publisher?: string | null
  language?: string | null
  isbn?: string | null
  asin?: string | null
  genres?: string[]
  explicit?: boolean
  abridged?: boolean
}

/** Write metadata (and optionally tags) back to an item. Admin only. */
export async function updateItemMetadata(
  t: AbsTarget,
  itemId: string,
  metadata: ItemMetadataPatch,
  tags?: string[]
): Promise<void> {
  const body: { metadata: ItemMetadataPatch; tags?: string[] } = { metadata }
  if (tags) body.tags = tags
  await absPatch(t, `/api/items/${encodeURIComponent(itemId)}/media`, body)
}

/** Replace an item's chapter list (POST /api/items/:id/chapters). Admin only. */
export async function updateItemChapters(
  t: AbsTarget,
  itemId: string,
  chapters: { title: string; start: number; end: number }[]
): Promise<void> {
  await absPost(t, `/api/items/${encodeURIComponent(itemId)}/chapters`, { chapters })
}

/** Delete one audio file from an item by its ino. Removes it from disk. Admin only. */
export async function deleteItemFile(t: AbsTarget, itemId: string, ino: string): Promise<void> {
  await absDelete(t, `/api/items/${encodeURIComponent(itemId)}/file/${encodeURIComponent(ino)}`)
}

/** Reorder a book's audio files. ABS wants the full ordered list of inos. Admin only. */
export async function reorderItemTracks(
  t: AbsTarget,
  itemId: string,
  orderedInos: string[]
): Promise<void> {
  await absPatch(t, `/api/items/${encodeURIComponent(itemId)}/tracks`, {
    orderedFileData: orderedInos.map((ino) => ({ ino })),
  })
}

/** Embed current metadata (and optionally chapters) back into the audio files. Admin only. */
export async function embedItemMetadata(
  t: AbsTarget,
  itemId: string,
  opts: { forceEmbedChapters?: boolean; backup?: boolean } = {}
): Promise<void> {
  const p = new URLSearchParams()
  if (opts.forceEmbedChapters) p.set('forceEmbedChapters', '1')
  if (opts.backup) p.set('backup', '1')
  const qs = p.toString()
  await absPost(t, `/api/tools/item/${encodeURIComponent(itemId)}/embed-metadata${qs ? '?' + qs : ''}`)
}
