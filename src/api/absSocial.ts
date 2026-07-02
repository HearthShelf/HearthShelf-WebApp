/**
 * Cross-user social reads (leaderboard, finished-by) against the connected
 * server's HearthShelf backend.
 *
 * Unlike the ABS-native /api/* surface (absClient.ts), the social endpoints live
 * under /hs/social/* on the same server origin and are served by the HearthShelf
 * Node backend, which reads ABS's database directly so every signed-in user (not
 * just admins) gets cross-user data. We reach it the same way absClient does:
 * the server's public origin + the per-server ABS bearer token.
 *
 * Every call degrades to a neutral "unavailable" value on ANY error (network,
 * 404, missing token, a slim deploy that doesn't expose /hs/social). The Stats
 * page hides the leaderboard entirely when available is false, so this never
 * breaks the page.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from './absLibrary'
import type {
  HSLeaderboardEntry,
  HSLeaderboardResponse,
  LeaderboardWindow,
  HSFinishedByUser,
  HSFinishedByResponse,
} from '@hearthshelf/core'

// Re-exported under the names this module has always used, so existing
// imports (StatsPage, etc.) keep working unchanged.
export type LeaderboardEntry = HSLeaderboardEntry
export type LeaderboardResponse = HSLeaderboardResponse
export type { LeaderboardWindow }

const UNAVAILABLE: LeaderboardResponse = { available: false, me: null, entries: [] }

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

export const socialKeys = {
  communityConfig: (serverId: string) => ['social', 'community-config', serverId] as const,
  leaderboard: (serverId: string, window: LeaderboardWindow) =>
    ['social', 'leaderboard', serverId, window] as const,
  finishedBy: (serverId: string, libraryItemId: string) =>
    ['social', 'finished-by', serverId, libraryItemId] as const,
}

/**
 * Instance-wide community config. `defaultShare` is the server's default for
 * whether a listener appears on the leaderboard before they choose for
 * themselves; `canEdit` is true only for admins (the PUT is admin-only).
 * Reads degrade to a neutral, non-editable default on any failure.
 */
export interface CommunityConfig {
  defaultShare: boolean
  canEdit: boolean
}

export async function getCommunityConfig(t: AbsTarget): Promise<CommunityConfig> {
  const token = getAbsToken(t.serverId)
  if (!token) return { defaultShare: true, canEdit: false }
  try {
    const res = await fetch(`${origin(t)}/hs/social/community-config`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) return { defaultShare: true, canEdit: false }
    return (await res.json()) as CommunityConfig
  } catch {
    return { defaultShare: true, canEdit: false }
  }
}

export async function setCommunityConfig(
  t: AbsTarget,
  defaultShare: boolean,
): Promise<CommunityConfig> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/social/community-config`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body: JSON.stringify({ defaultShare }),
  })
  if (!res.ok) throw new Error(`community-config ${res.status}`)
  return (await res.json()) as CommunityConfig
}

interface RawEntry {
  rank?: number
  userId?: string
  username?: string
  booksFinished?: number
  secondsListened?: number
  isMe?: boolean
}

interface RawLeaderboard {
  available?: boolean
  me?: RawEntry | null
  entries?: RawEntry[]
  window?: LeaderboardWindow
  windowsAvailable?: boolean
}

function mapEntry(r: RawEntry): LeaderboardEntry {
  return {
    rank: r.rank ?? 0,
    userId: r.userId ?? '',
    username: r.username ?? '',
    booksFinished: r.booksFinished ?? 0,
    secondsListened: r.secondsListened ?? 0,
    isMe: Boolean(r.isMe),
  }
}

/**
 * Cross-user listening leaderboard for the active server. Returns
 * { available: false } on any failure so the caller can hide the section.
 * `window` requests a time-windowed leaderboard (week/month/all); omit for the
 * server default. Older servers ignore the param and/or omit `windowsAvailable`
 * from the response - callers should hide the window pills in that case.
 */
export async function getLeaderboard(
  t: AbsTarget,
  window?: LeaderboardWindow,
): Promise<LeaderboardResponse> {
  const token = getAbsToken(t.serverId)
  if (!token) return UNAVAILABLE
  try {
    const qs = window ? `?window=${encodeURIComponent(window)}` : ''
    const res = await fetch(`${origin(t)}/hs/social/leaderboard${qs}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) return UNAVAILABLE
    const data = (await res.json()) as RawLeaderboard
    if (!data || data.available !== true) return UNAVAILABLE
    return {
      available: true,
      me: data.me ? mapEntry(data.me) : null,
      entries: (data.entries ?? []).map(mapEntry),
      window: data.window,
      windowsAvailable: data.windowsAvailable,
    }
  } catch {
    return UNAVAILABLE
  }
}

interface RawFinishedByUser {
  userId?: string
  username?: string
  finishedAt?: number | null
}

interface RawFinishedBy {
  available?: boolean
  users?: RawFinishedByUser[]
}

const FINISHED_BY_UNAVAILABLE: HSFinishedByResponse = { available: false, users: [] }

/**
 * Who finished a book, privacy-filtered server-side. Returns
 * { available: false, users: [] } on any failure/older server so the caller
 * can hide the chips row.
 */
export async function getFinishedBy(
  t: AbsTarget,
  libraryItemId: string,
): Promise<HSFinishedByResponse> {
  const token = getAbsToken(t.serverId)
  if (!token) return FINISHED_BY_UNAVAILABLE
  try {
    const res = await fetch(
      `${origin(t)}/hs/social/finished-by?libraryItemId=${encodeURIComponent(libraryItemId)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    )
    if (!res.ok) return FINISHED_BY_UNAVAILABLE
    const data = (await res.json()) as RawFinishedBy
    if (!data || data.available !== true) return FINISHED_BY_UNAVAILABLE
    const users: HSFinishedByUser[] = (data.users ?? []).map((u) => ({
      userId: u.userId ?? '',
      username: u.username ?? '',
      finishedAt: u.finishedAt ?? null,
    }))
    return { available: true, users }
  } catch {
    return FINISHED_BY_UNAVAILABLE
  }
}
