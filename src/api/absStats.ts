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
import { getAbsToken } from '@/lib/absTokens'
import type {
  HSListeningStats,
  HSStatsHistory,
  HSStatsHistoryDay,
  HSStatsHighlights,
  HSStatsMonth,
} from '@hearthshelf/core'

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

/**
 * Richer listening stats from the connected server's HearthShelf backend
 * (`GET /hs/stats`). Beyond what ABS's REST payload exposes, this adds
 * server-computed streak / week / active-days, a day-of-week breakdown, the
 * finished-book counts (all-time + this year), and a session count. See
 * @hearthshelf/core HSListeningStats.
 *
 * Reached the same way absSocial does: the server's public origin + the
 * per-server ABS bearer token. Returns null on ANY failure (no token, network,
 * 404 on a slim/older deploy without /hs/stats) so the Stats page can fall back
 * to the ABS-native getListeningStatsFull.
 *
 * `tz` is the caller's timezone offset in minutes (Date.getTimezoneOffset()), so
 * the server buckets "today" / the year window in the caller's local time.
 */
export async function getHsStats(t: AbsTarget): Promise<HSListeningStats | null> {
  const token = getAbsToken(t.serverId)
  if (!token) return null
  try {
    const tz = new Date().getTimezoneOffset()
    const res = await fetch(`${origin(t)}/hs/stats?tz=${tz}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) return null
    return mapHsStats((await res.json()) as RawHsStats)
  } catch {
    return null
  }
}

/**
 * Durable daily listening history (`GET /hs/stats/history?range=`), the nightly
 * snapshot job's output. Unlike ABS's trailing window, this survives ABS
 * restarts/re-scans and grows for every day since the job started - the source
 * for the full-year heatmap. Degrades to { available: false, days: [] } on any
 * failure, matching the server's own unavailable response.
 */
export async function getStatsHistory(
  t: AbsTarget,
  range: 'week' | 'month' | 'year' | 'all' = 'all',
): Promise<HSStatsHistory> {
  const token = getAbsToken(t.serverId)
  if (!token) return HISTORY_UNAVAILABLE
  try {
    const res = await fetch(`${origin(t)}/hs/stats/history?range=${encodeURIComponent(range)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) return HISTORY_UNAVAILABLE
    const data = (await res.json()) as RawHistory
    if (!data || data.available !== true) return HISTORY_UNAVAILABLE
    return {
      available: true,
      days: (data.days ?? []).map(mapHistoryDay),
      months: (data.months ?? []).map(mapHistoryMonth),
    }
  } catch {
    return HISTORY_UNAVAILABLE
  }
}

export const statsKeys = {
  hsStats: (serverId: string) => ['abs-stats', 'hs', serverId] as const,
  history: (serverId: string, range: string) =>
    ['abs-stats', 'history', serverId, range] as const,
}

const HISTORY_UNAVAILABLE: HSStatsHistory = { available: false, days: [] }

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

// The server may omit newer fields on older builds, so every field is coerced.
// byDay/byDayOfWeek default to {}, numeric totals to 0, and the ABS-db-derived
// finished/session counts to null (their "not mounted" sentinel).
interface RawHsStats {
  totalTimeSec?: number
  todaySec?: number
  weekSec?: number
  dayStreak?: number
  activeDays?: number
  byDay?: Record<string, number>
  byDayOfWeek?: Record<string, number>
  byWeekdayAvg?: Record<string, number>
  mostListened?: Array<{
    id?: string
    title?: string
    author?: string
    narrator?: string
    timeSec?: number
  }>
  booksFinished?: number | null
  booksThisYear?: number | null
  sessionCount?: number | null
  highlights?: RawHighlights | null
}

interface RawHighlights {
  longestBook?: { title?: string; durationSec?: number } | null
  shortestBook?: { title?: string; durationSec?: number } | null
  topAuthor?: { name?: string; count?: number } | null
  topNarrator?: { name?: string; count?: number } | null
}

function numOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' ? v : null
}

function mapHighlightBook(
  b: { title?: string; durationSec?: number } | null | undefined,
): { title: string; durationSec: number } | null {
  if (!b || typeof b.durationSec !== 'number') return null
  return { title: b.title ?? '', durationSec: b.durationSec }
}

function mapHighlightPerson(
  p: { name?: string; count?: number } | null | undefined,
): { name: string; count: number } | null {
  if (!p || !p.name) return null
  return { name: p.name, count: p.count ?? 0 }
}

function mapHighlights(h: RawHighlights | null | undefined): HSStatsHighlights | null {
  if (!h) return null
  return {
    longestBook: mapHighlightBook(h.longestBook),
    shortestBook: mapHighlightBook(h.shortestBook),
    topAuthor: mapHighlightPerson(h.topAuthor),
    topNarrator: mapHighlightPerson(h.topNarrator),
  }
}

function mapHsStats(d: RawHsStats): HSListeningStats {
  return {
    totalTimeSec: d.totalTimeSec ?? 0,
    todaySec: d.todaySec ?? 0,
    weekSec: d.weekSec ?? 0,
    dayStreak: d.dayStreak ?? 0,
    activeDays: d.activeDays ?? 0,
    byDay: d.byDay ?? {},
    byDayOfWeek: d.byDayOfWeek ?? {},
    byWeekdayAvg: d.byWeekdayAvg ?? {},
    mostListened: (d.mostListened ?? []).map((m) => ({
      id: m.id ?? '',
      title: m.title ?? 'Untitled',
      author: m.author ?? '',
      narrator: m.narrator ?? '',
      timeSec: m.timeSec ?? 0,
    })),
    booksFinished: numOrNull(d.booksFinished),
    booksThisYear: numOrNull(d.booksThisYear),
    sessionCount: numOrNull(d.sessionCount),
    highlights: mapHighlights(d.highlights),
  }
}

interface RawHistory {
  available?: boolean
  days?: Array<{
    date?: string
    secondsListened?: number
    sessions?: number
    booksFinished?: number
  }>
  months?: Array<{
    month?: string
    seconds?: number
    books?: number
    activeDays?: number
  }>
}

function mapHistoryDay(d: NonNullable<RawHistory['days']>[number]): HSStatsHistoryDay {
  return {
    date: d.date ?? '',
    secondsListened: d.secondsListened ?? 0,
    sessions: d.sessions ?? 0,
    booksFinished: d.booksFinished ?? 0,
  }
}

function mapHistoryMonth(m: NonNullable<RawHistory['months']>[number]): HSStatsMonth {
  return {
    month: m.month ?? '',
    seconds: m.seconds ?? 0,
    books: m.books ?? 0,
    activeDays: m.activeDays ?? 0,
  }
}
