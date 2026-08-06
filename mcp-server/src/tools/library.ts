/**
 * Tool implementations - the ABS/HearthShelf reads behind each MCP tool.
 *
 * Shapes mirror the SPA's own clients (src/api/absLibrary.ts, absHome.ts,
 * absStats.ts, absDiscover.ts) so the two stay recognisably the same API. We
 * re-derive them here rather than importing because the Worker builds
 * independently of the SPA.
 *
 * Everything returned here lands in a model's context window, so results are
 * FLATTENED and TRIMMED: no cover URLs, no ABS internals, no giant nested
 * media objects. A tool that dumps raw ABS JSON burns the user's context for
 * no benefit.
 */
import type { AbsSession } from '../lib/absClient'

// --- raw ABS shapes (only the fields we actually read) ----------------------

interface RawMetadata {
  title?: string
  authorName?: string
  narratorName?: string
  seriesName?: string
  genres?: string[]
  publishedYear?: string
  description?: string
}

interface RawItem {
  id: string
  libraryId?: string
  mediaType?: string
  media?: { metadata?: RawMetadata; duration?: number }
}

interface RawProgress {
  libraryItemId: string
  progress?: number
  isFinished?: boolean
  finishedAt?: number
}

// --- public result shapes ---------------------------------------------------

export interface BookSummary {
  id: string
  title: string
  author: string
  narrator?: string
  series?: string
  genres?: string[]
  year?: string
  duration_hours?: number
}

function hours(seconds?: number): number | undefined {
  if (!seconds || seconds <= 0) return undefined
  return Math.round((seconds / 3600) * 10) / 10
}

function summarize(item: RawItem): BookSummary {
  const md = item.media?.metadata ?? {}
  const out: BookSummary = {
    id: item.id,
    title: md.title || 'Untitled',
    author: md.authorName || '',
  }
  if (md.narratorName) out.narrator = md.narratorName
  if (md.seriesName) out.series = md.seriesName
  if (md.genres?.length) out.genres = md.genres
  if (md.publishedYear) out.year = md.publishedYear
  const h = hours(item.media?.duration)
  if (h) out.duration_hours = h
  return out
}

// --- libraries --------------------------------------------------------------

export async function getLibraries(abs: AbsSession, serverId: string) {
  const data = await abs.get<{
    libraries?: Array<{ id: string; name?: string; mediaType?: string }>
  }>(serverId, '/api/libraries')
  return (data.libraries ?? []).map((l) => ({
    id: l.id,
    name: l.name ?? '',
    media_type: l.mediaType ?? 'book',
  }))
}

// --- search -----------------------------------------------------------------

export async function searchLibrary(
  abs: AbsSession,
  serverId: string,
  query: string,
  libraryId: string | undefined,
  limit: number,
): Promise<BookSummary[]> {
  const q = query.trim()
  if (!q) return []

  const libraryIds = libraryId ? [libraryId] : (await getLibraries(abs, serverId)).map((l) => l.id)

  const results: BookSummary[] = []
  for (const id of libraryIds) {
    if (results.length >= limit) break
    const data = await abs.get<{
      book?: Array<{ libraryItem?: RawItem }>
      podcast?: Array<{ libraryItem?: RawItem }>
    }>(
      serverId,
      `/api/libraries/${encodeURIComponent(id)}/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    )
    const entries = [...(data.book ?? []), ...(data.podcast ?? [])]
    for (const e of entries) {
      if (e.libraryItem) results.push(summarize(e.libraryItem))
    }
  }
  return results.slice(0, limit)
}

// --- one item ---------------------------------------------------------------

export async function getItem(abs: AbsSession, serverId: string, itemId: string) {
  const item = await abs.get<RawItem>(
    serverId,
    `/api/items/${encodeURIComponent(itemId)}?expanded=1`,
  )
  const base = summarize(item)
  const md = item.media?.metadata ?? {}

  // Progress lives on /api/me, not on the item, so fetch it alongside.
  const me = await abs.get<{ mediaProgress?: RawProgress[] }>(serverId, '/api/me')
  const prog = (me.mediaProgress ?? []).find((p) => p.libraryItemId === itemId)

  return {
    ...base,
    description: md.description ? stripHtml(md.description) : undefined,
    progress_percent: prog ? Math.round((prog.progress ?? 0) * 100) : 0,
    finished: Boolean(prog?.isFinished),
  }
}

/** ABS descriptions may contain HTML; a model reads the text better without it. */
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// --- in progress ------------------------------------------------------------

export async function getInProgress(abs: AbsSession, serverId: string) {
  const data = await abs.get<{ libraryItems?: RawItem[] }>(serverId, '/api/me/items-in-progress')
  const items = data.libraryItems ?? []
  if (items.length === 0) return []

  const me = await abs.get<{ mediaProgress?: RawProgress[] }>(serverId, '/api/me')
  const byId = new Map((me.mediaProgress ?? []).map((p) => [p.libraryItemId, p]))

  return items.map((i) => ({
    ...summarize(i),
    progress_percent: Math.round((byId.get(i.id)?.progress ?? 0) * 100),
  }))
}

// --- finished / reading history --------------------------------------------

/**
 * Finished books, newest first. ABS records completion on mediaProgress, so we
 * take the finished set from /api/me and hydrate titles from the library.
 *
 * We deliberately do NOT call HearthShelf's /hs/finished-books here: that
 * surface also covers books imported from outside the library (Goodreads etc.)
 * and needs its own shape work. Tracked as a follow-up; ABS-native finishes are
 * the correct v1 signal and are always present.
 */
export async function getFinished(abs: AbsSession, serverId: string, limit: number) {
  const me = await abs.get<{ mediaProgress?: RawProgress[] }>(serverId, '/api/me')
  const finished = (me.mediaProgress ?? [])
    .filter((p) => p.isFinished)
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
    .slice(0, limit)

  const out: Array<BookSummary & { finished_at?: string }> = []
  for (const p of finished) {
    try {
      const item = await abs.get<RawItem>(
        serverId,
        `/api/items/${encodeURIComponent(p.libraryItemId)}`,
      )
      const row: BookSummary & { finished_at?: string } = summarize(item)
      if (p.finishedAt) row.finished_at = new Date(p.finishedAt).toISOString().slice(0, 10)
      out.push(row)
    } catch {
      // An item can be finished but since deleted from the library; skip it
      // rather than failing the whole history.
    }
  }
  return out
}

// --- stats ------------------------------------------------------------------

export async function getListeningStats(abs: AbsSession, serverId: string) {
  const data = await abs.get<{
    totalTime?: number
    today?: number
    days?: Record<string, number>
  }>(serverId, '/api/me/listening-stats')

  const days = data.days ?? {}
  // Only the most recent 30 days - the full map can be years long and is mostly
  // noise in a context window.
  const recent = Object.entries(days)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, 30)

  return {
    total_hours: Math.round(((data.totalTime ?? 0) / 3600) * 10) / 10,
    today_minutes: Math.round((data.today ?? 0) / 60),
    recent_days: Object.fromEntries(recent.map(([d, s]) => [d, Math.round(s / 60)])),
  }
}

// --- recommendations --------------------------------------------------------

/**
 * HearthShelf's own Discover picks. This is the box's `/hs/discover` surface,
 * not ABS. Degrades to an empty list on any failure (an older box may not have
 * it) so the tool never hard-fails a conversation.
 */
export async function getRecommendations(abs: AbsSession, serverId: string) {
  try {
    const data = await abs.get<{
      picks?: Array<{ title?: string; author?: string; reason?: string; itemId?: string }>
    }>(serverId, '/hs/discover/shelf')
    return (data.picks ?? []).map((p) => ({
      id: p.itemId,
      title: p.title ?? '',
      author: p.author ?? '',
      why: p.reason ?? undefined,
    }))
  } catch {
    return []
  }
}

// --- similar ----------------------------------------------------------------

/**
 * Neighbours of an item WITHIN the user's library, scored by shared series >
 * author > narrator > genre. Deliberately simple and deterministic: the client's
 * model does the actual judging, so this only has to supply good candidates.
 */
export async function findSimilar(
  abs: AbsSession,
  serverId: string,
  itemId: string,
  limit: number,
) {
  const seed = await abs.get<RawItem>(serverId, `/api/items/${encodeURIComponent(itemId)}`)
  const md = seed.media?.metadata ?? {}

  // Search by the seed's strongest identifiers and pool the hits.
  const queries = [md.seriesName, md.authorName, md.narratorName].filter((q): q is string =>
    Boolean(q),
  )
  const pool = new Map<string, BookSummary>()
  for (const q of queries) {
    const hits = await searchLibrary(abs, serverId, q, undefined, 25)
    for (const h of hits) {
      if (h.id !== itemId) pool.set(h.id, h)
    }
  }

  const seedGenres = new Set((md.genres ?? []).map((g) => g.toLowerCase()))
  const scored = [...pool.values()].map((b) => {
    let score = 0
    let reason = ''
    if (md.seriesName && b.series === md.seriesName) {
      score += 100
      reason = `Same series: ${md.seriesName}`
    } else if (md.authorName && b.author === md.authorName) {
      score += 50
      reason = `Same author: ${md.authorName}`
    } else if (md.narratorName && b.narrator === md.narratorName) {
      score += 25
      reason = `Same narrator: ${md.narratorName}`
    }
    const shared = (b.genres ?? []).filter((g) => seedGenres.has(g.toLowerCase()))
    if (shared.length) {
      score += shared.length * 5
      if (!reason) reason = `Shared genres: ${shared.join(', ')}`
    }
    return { ...b, why: reason || 'Also in your library', _score: score }
  })

  return scored
    .filter((b) => b._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...rest }) => rest)
}
