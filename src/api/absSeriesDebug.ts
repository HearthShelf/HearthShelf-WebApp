/**
 * Admin client for the connected server's series-matching debugger
 * (/hs/admin/series-debug/*). Reached like absJobs.ts: the connected server's
 * origin + the per-server ABS bearer token. Admin-only server-side.
 *
 * Mirrors the self-hosted UI's src/api/seriesDebug.ts and the server's
 * server/lib/seriesDebug.js - keep the three in step. Unlike most clients here,
 * failures THROW rather than degrading to empty: this is a diagnostic surface,
 * and silently showing "no problems" when the request failed is the one
 * behaviour it must never have.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from './absLibrary'

export interface SeriesDebugPick {
  seriesId: string
  name: string
}

/** One raw Audible child, plus what roster filtering did to it. */
export interface SeriesDebugRosterBook {
  asin: string | null
  title: string
  /** The title the matcher actually compares. When this reads as the series
   *  name plus a number rather than the book's own name, the prefix strip
   *  missed - that exact bug hid whole series. */
  normalizedTitle: string
  sequence: string
  sequenceKey: string
  releaseDate: string | null
  durationMinutes: number | null
  narrator: string | null
  hasCover: boolean
  isPlaceholder: boolean
  editionScore: number
  kept: boolean
  droppedBy: 'phantom-placeholder' | 'duplicate-edition' | null
  droppedFor: string | null
}

export interface SeriesDebugAttempt {
  signal: 'asin' | 'title' | 'sequence'
  outcome: 'matched' | 'no-match' | 'refused' | 'skipped'
  detail: string
}

export interface SeriesDebugMatch {
  asin: string | null
  title: string
  normalizedTitle: string
  sequence: string
  sequenceKey: string
  owned: boolean
  matchedBy: 'asin' | 'title' | 'sequence' | null
  matchedOwned: string | null
  attempts: SeriesDebugAttempt[]
}

export interface SeriesDebugOwnedBook {
  asin: string
  title: string
  normalizedTitle: string
  sequence: string
  sequenceKey: string
  author: string
  /** A delisted ASIN is not evidence, so it must not veto title/sequence. */
  asinIsLive: boolean
  eligibleFor: string[]
  claimedBy: string | null
}

export interface SeriesDebugDrift {
  asin: string
  title: string
  kind: 'only-live' | 'only-stored' | 'owned-differs'
  stored?: boolean
  live?: boolean
}

export interface SeriesDebugReport {
  seriesId: string
  name: string
  ownedCount: number
  resolution: {
    query: string
    ownedAuthors: string[]
    matched: { asin: string; title: string } | null
    votes: number
    authorHits: number
  } | null
  roster: {
    seriesAsin: string | null
    rawCount: number
    keptCount: number
    books: SeriesDebugRosterBook[]
  }
  matching: {
    results: SeriesDebugMatch[]
    owned: SeriesDebugOwnedBook[]
  }
  stored: {
    present: boolean
    resolvedAt: number | null
    seriesAsin: string | null
    seriesTitle?: string | null
    name?: string
    bookCount: number
    drift: SeriesDebugDrift[]
  } | null
  generatedAt: number
}

export const seriesDebugKeys = {
  list: (serverId: string) => ['series-debug', 'list', serverId] as const,
}

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

async function debugFetch<T>(t: AbsTarget, path: string, options: RequestInit = {}): Promise<T> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('Not connected to this server.')
  const res = await fetch(`${origin(t)}/hs/admin/series-debug${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      detail?: string
      error?: string
    } | null
    if (res.status === 403) throw new Error('You need to be an admin on this server.')
    throw new Error(body?.detail ?? body?.error ?? `Series debugger failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export async function getDebuggableSeries(t: AbsTarget): Promise<SeriesDebugPick[]> {
  const body = await debugFetch<{ series: SeriesDebugPick[] }>(t, '/list')
  return body.series
}

export async function getSeriesDebugReport(
  t: AbsTarget,
  seriesId: string,
): Promise<SeriesDebugReport> {
  const query = new URLSearchParams({ seriesId })
  return debugFetch<SeriesDebugReport>(t, `?${query}`)
}

/** Re-resolve and re-store ONE series' roster now, rather than waiting for the
 *  nightly sweep. The only write on this surface. */
export async function resweepSeries(
  t: AbsTarget,
  seriesId: string,
): Promise<{ resolved: boolean; books: number }> {
  const query = new URLSearchParams({ seriesId })
  return debugFetch<{ resolved: boolean; books: number }>(t, `/resweep?${query}`, {
    method: 'POST',
  })
}
