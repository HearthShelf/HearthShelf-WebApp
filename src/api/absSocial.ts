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
  HSListeningNowUser,
  HSListeningNowResponse,
  HSListeningNowBulkResponse,
  HSCompareResponse,
  HSCompareStats,
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
  listeningNow: (serverId: string, libraryItemId: string) =>
    ['social', 'listening-now', serverId, libraryItemId] as const,
  compare: (serverId: string, userId: string) => ['social', 'compare', serverId, userId] as const,
}

/**
 * Instance-wide community config. `defaultShare` is the server's default for
 * whether a listener appears on the leaderboard before they choose for
 * themselves; `canEdit` is true only for admins (the PUT is admin-only).
 * Reads degrade to a neutral, non-editable default on any failure.
 */
export interface CommunityConfig {
  defaultShare: boolean
  defaultShareListening: boolean
  notesEnabled: boolean
  clubsEnabled: boolean
  canEdit: boolean
}

const COMMUNITY_CONFIG_FALLBACK: CommunityConfig = {
  defaultShare: true,
  defaultShareListening: false,
  notesEnabled: true,
  clubsEnabled: true,
  canEdit: false,
}

interface RawCommunityConfig {
  defaultShare?: boolean
  defaultShareListening?: boolean
  notesEnabled?: boolean
  clubsEnabled?: boolean
  canEdit?: boolean
}

function mapCommunityConfig(data: RawCommunityConfig): CommunityConfig {
  return {
    defaultShare: data.defaultShare ?? true,
    defaultShareListening: data.defaultShareListening ?? false,
    notesEnabled: data.notesEnabled ?? true,
    clubsEnabled: data.clubsEnabled ?? true,
    canEdit: Boolean(data.canEdit),
  }
}

export async function getCommunityConfig(t: AbsTarget): Promise<CommunityConfig> {
  const token = getAbsToken(t.serverId)
  if (!token) return COMMUNITY_CONFIG_FALLBACK
  try {
    const res = await fetch(`${origin(t)}/hs/social/community-config`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) return COMMUNITY_CONFIG_FALLBACK
    return mapCommunityConfig((await res.json()) as RawCommunityConfig)
  } catch {
    return COMMUNITY_CONFIG_FALLBACK
  }
}

// Partial update - only sent fields change. Older servers that don't know a
// field simply ignore it server-side.
export async function setCommunityConfig(
  t: AbsTarget,
  patch: Partial<
    Pick<CommunityConfig, 'defaultShare' | 'defaultShareListening' | 'notesEnabled' | 'clubsEnabled'>
  >,
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
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`community-config ${res.status}`)
  return mapCommunityConfig((await res.json()) as RawCommunityConfig)
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

interface RawListeningNowUser {
  userId?: string
  username?: string
}

const LISTENING_NOW_UNAVAILABLE: HSListeningNowResponse = { available: false, users: [] }
const LISTENING_NOW_BULK_UNAVAILABLE: HSListeningNowBulkResponse = { available: false, byItem: {} }

function mapListeningNowUser(u: RawListeningNowUser): HSListeningNowUser {
  return { userId: u.userId ?? '', username: u.username ?? '' }
}

/**
 * Who's actively (recently) listening to a book right now-ish, privacy-filtered
 * server-side by the shareCurrentlyListening resolution. Returns
 * { available: false, users: [] } on any failure/older server/disabled surface.
 */
export async function getListeningNow(
  t: AbsTarget,
  libraryItemId: string,
): Promise<HSListeningNowResponse> {
  const token = getAbsToken(t.serverId)
  if (!token) return LISTENING_NOW_UNAVAILABLE
  try {
    const res = await fetch(
      `${origin(t)}/hs/social/listening-now?libraryItemId=${encodeURIComponent(libraryItemId)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    )
    if (!res.ok) return LISTENING_NOW_UNAVAILABLE
    const data = (await res.json()) as { available?: boolean; users?: RawListeningNowUser[] }
    if (!data || data.available !== true) return LISTENING_NOW_UNAVAILABLE
    return { available: true, users: (data.users ?? []).map(mapListeningNowUser) }
  } catch {
    return LISTENING_NOW_UNAVAILABLE
  }
}

/** Bulk listening-now for shelf badges. Caps at 100 ids server-side. */
export async function getListeningNowBulk(
  t: AbsTarget,
  libraryItemIds: string[],
): Promise<HSListeningNowBulkResponse> {
  const token = getAbsToken(t.serverId)
  if (!token || libraryItemIds.length === 0) return LISTENING_NOW_BULK_UNAVAILABLE
  try {
    const res = await fetch(`${origin(t)}/hs/social/listening-now`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      body: JSON.stringify({ libraryItemIds: libraryItemIds.slice(0, 100) }),
    })
    if (!res.ok) return LISTENING_NOW_BULK_UNAVAILABLE
    const data = (await res.json()) as {
      available?: boolean
      byItem?: Record<string, RawListeningNowUser[]>
    }
    if (!data || data.available !== true) return LISTENING_NOW_BULK_UNAVAILABLE
    const byItem: Record<string, HSListeningNowUser[]> = {}
    for (const [id, users] of Object.entries(data.byItem ?? {})) {
      byItem[id] = users.map(mapListeningNowUser)
    }
    return { available: true, byItem }
  } catch {
    return LISTENING_NOW_BULK_UNAVAILABLE
  }
}

const ZERO_COMPARE_STATS: HSCompareStats = {
  booksFinished: 0,
  secondsListened: 0,
  activeDays: null,
}

const COMPARE_UNAVAILABLE: HSCompareResponse = {
  available: false,
  scope: 'server',
  me: ZERO_COMPARE_STATS,
  target: ZERO_COMPARE_STATS,
}

interface RawCompareStats {
  booksFinished?: number
  secondsListened?: number
  activeDays?: number | null
}

interface RawCompare {
  available?: boolean
  scope?: 'server' | 'user'
  me?: RawCompareStats | null
  target?: RawCompareStats | null
  userId?: string
  username?: string
}

function mapCompareStats(r: RawCompareStats | null | undefined): HSCompareStats {
  return {
    booksFinished: r?.booksFinished ?? 0,
    secondsListened: r?.secondsListened ?? 0,
    activeDays: typeof r?.activeDays === 'number' ? r.activeDays : null,
  }
}

/**
 * Compare the caller's listening totals against a target: the whole-server
 * per-user average (default, no identity leaked) or one opted-in user
 * (`opts.userId`, drawn only from the leaderboard's privacy-filtered roster).
 *
 * Returns a neutral unavailable response on ANY failure/older server, and also
 * when the server reports available:false (it sends me:null/target:null then, so
 * we normalize to zeroed stats the caller can gate on `available`). The user
 * variant 403s server-side if the target isn't shareable - that degrades to
 * unavailable here so the picker never breaks.
 */
export async function getCompare(
  t: AbsTarget,
  opts: { userId?: string } = {},
): Promise<HSCompareResponse> {
  const token = getAbsToken(t.serverId)
  if (!token) return COMPARE_UNAVAILABLE
  try {
    const qs = opts.userId ? `?userId=${encodeURIComponent(opts.userId)}` : ''
    const res = await fetch(`${origin(t)}/hs/social/compare${qs}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) return COMPARE_UNAVAILABLE
    const data = (await res.json()) as RawCompare
    if (!data || data.available !== true || !data.me || !data.target) return COMPARE_UNAVAILABLE
    return {
      available: true,
      scope: data.scope === 'user' ? 'user' : 'server',
      me: mapCompareStats(data.me),
      target: mapCompareStats(data.target),
      userId: data.userId,
      username: data.username,
    }
  } catch {
    return COMPARE_UNAVAILABLE
  }
}
