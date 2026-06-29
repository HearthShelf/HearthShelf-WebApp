/**
 * Full listening-stats read, including the per-item breakdown ABS returns in
 * /api/me/listening-stats's `items` map.
 *
 * absLibrary.getListeningStats keeps only the totals + per-day series the
 * heatmap/streak needs and drops the items map. The Stats page's "Most listened"
 * section needs that map (cover + title/author + seconds per item), so this is a
 * second, richer read of the same endpoint. Shape verified against the
 * self-hosted ABSListeningStats (items: Record<id, { id, mediaMetadata,
 * timeListening }>).
 */
import { absGet } from './absClient'
import type { AbsTarget } from './absLibrary'

/** One book's all-time listening time, resolved for the "Most listened" list. */
export interface StatsItem {
  id: string
  title: string
  author: string
  narrator: string
  /** All-time seconds listened for this item. */
  timeListeningSec: number
}

export interface ListeningStatsFull {
  /** All-time seconds listened. */
  totalTimeSec: number
  /** Seconds listened today. */
  todaySec: number
  /** Seconds per ISO date (YYYY-MM-DD). */
  byDay: Record<string, number>
  /** Per-item all-time listening time, sorted-by-time at render. */
  items: StatsItem[]
}

interface RawStatsMetadata {
  title?: string | null
  authorName?: string
  authors?: Array<{ id?: string; name?: string }>
  narratorName?: string
  narrators?: string[]
}

interface RawStatsItem {
  id?: string
  mediaMetadata?: RawStatsMetadata
  timeListening?: number
}

interface RawListeningStatsFull {
  totalTime?: number
  today?: number
  days?: Record<string, number>
  items?: Record<string, RawStatsItem>
}

function authorOf(md: RawStatsMetadata | undefined): string {
  if (!md) return ''
  return md.authorName || md.authors?.[0]?.name || ''
}

function narratorOf(md: RawStatsMetadata | undefined): string {
  if (!md) return ''
  return md.narratorName || md.narrators?.[0] || ''
}

export async function getListeningStatsFull(t: AbsTarget): Promise<ListeningStatsFull> {
  const data = await absGet<RawListeningStatsFull>(t, '/api/me/listening-stats')
  const items: StatsItem[] = Object.entries(data.items ?? {}).map(([key, raw]) => {
    const md = raw.mediaMetadata
    return {
      id: raw.id || key,
      title: md?.title || 'Untitled',
      author: authorOf(md),
      narrator: narratorOf(md),
      timeListeningSec: raw.timeListening ?? 0,
    }
  })
  return {
    totalTimeSec: data.totalTime ?? 0,
    todaySec: data.today ?? 0,
    byDay: data.days ?? {},
    items,
  }
}
