/**
 * Discover backend client against the connected server's HearthShelf backend.
 *
 * Like absSocial.ts (the leaderboard) and absRequests.ts, these endpoints live
 * under /hs/discover* on the connected server's own origin and are served by the
 * HearthShelf Node backend (NOT the ABS-native /api/* surface). We reach them the
 * same way absClient does: the server's public origin + the per-server ABS bearer
 * token.
 *
 * Every call swallows errors into a neutral value so the page never breaks -
 * Discover degrades to its deterministic, library-only base shelves when the
 * backend is down. Shapes mirror HearthShelf's own discover.ts.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from './absLibrary'
import type { DiscoverSummary, DiscoverCandidate } from '@/lib/discover'

export type DiscoverVote = 'like' | 'dislike' | 'not_interested'

export interface DiscoverFeedbackEntry {
  vote?: DiscoverVote
  rating?: number
}
export type DiscoverFeedbackMap = Record<string, DiscoverFeedbackEntry>

export interface MonthlyPick {
  id: string
  reason: string
}
export interface MonthlyShelf {
  month: string
  engine: 'ai' | 'heuristic' | 'none'
  intro: string
  picks: MonthlyPick[]
}

export interface PopularItem {
  itemId: string
  finishedBy: number
  inProgressBy: number
}

/** Admin gate for the Discover surface. False until the backend confirms it. */
export interface DiscoverConfig {
  enabled: boolean
}

const EMPTY_SHELF: MonthlyShelf = { month: '', engine: 'none', intro: '', picks: [] }

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

async function dFetch<T>(t: AbsTarget, path: string, options: RequestInit = {}): Promise<T> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/discover${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  if (!res.ok) throw new Error(`Discover ${res.status}`)
  return res.json() as Promise<T>
}

/**
 * Is Discover enabled on this server? Returns { enabled: false } on any failure
 * so the nav + gate hide the surface when the backend doesn't expose it.
 */
export async function getDiscoverConfig(t: AbsTarget): Promise<DiscoverConfig> {
  try {
    const data = await dFetch<{ enabled?: boolean; discoverEnabled?: boolean }>(t, '/config')
    return { enabled: data.enabled === true || data.discoverEnabled === true }
  } catch {
    return { enabled: false }
  }
}

/**
 * Fetch-or-generate the month's AI shelf. The backend returns the cached shelf if
 * one exists for this user+month, otherwise generates from the posted summary +
 * candidates. Returns an empty shelf on any failure (Discover still renders its
 * deterministic base shelves).
 */
export async function getMonthlyShelf(
  t: AbsTarget,
  summary: DiscoverSummary,
  candidates: DiscoverCandidate[]
): Promise<MonthlyShelf> {
  if (!candidates.length) return EMPTY_SHELF
  try {
    return await dFetch<MonthlyShelf>(t, '', {
      method: 'POST',
      body: JSON.stringify({ summary, candidates }),
    })
  } catch {
    return EMPTY_SHELF
  }
}

export async function getDiscoverFeedback(t: AbsTarget): Promise<DiscoverFeedbackMap> {
  try {
    const r = await dFetch<{ feedback: DiscoverFeedbackMap }>(t, '/feedback')
    return r.feedback ?? {}
  } catch {
    return {}
  }
}

export async function setDiscoverFeedback(
  t: AbsTarget,
  itemKey: string,
  fb: { vote?: DiscoverVote | null; rating?: number | null }
): Promise<DiscoverFeedbackMap> {
  try {
    const r = await dFetch<{ feedback: DiscoverFeedbackMap }>(t, '/feedback', {
      method: 'POST',
      body: JSON.stringify({ itemKey, ...fb }),
    })
    return r.feedback ?? {}
  } catch {
    return {}
  }
}

export async function getPopular(t: AbsTarget): Promise<PopularItem[]> {
  try {
    const r = await dFetch<{ items: PopularItem[] }>(t, '/popular')
    return r.items ?? []
  } catch {
    return []
  }
}
