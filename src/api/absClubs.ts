/**
 * Book Club (Phase 5) against the connected server's HearthShelf backend.
 * Same rails as absSocial.ts / absNotes.ts: /hs/clubs on the server's own
 * origin, reached with the per-server ABS bearer token, degrading to a
 * neutral "disabled" envelope on any error so callers hide the club UI.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from './absLibrary'
import { mapNote, type RawNote } from './absNotes'
import type {
  HSClub,
  HSClubBook,
  HSClubMember,
  HSClubDetail,
  HSClubsResponse,
  ClubRecBasis,
} from '@hearthshelf/core'

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

const CLUBS_DISABLED: HSClubsResponse = { enabled: false, mine: [], joinable: [] }

export type ClubVisibility = 'closed' | 'public'
type ClubSummary = HSClub & {
  visibility: ClubVisibility
  lastActivityAt: number
  allowCommentEditing: boolean
  allowReplies: boolean
  autoAdvanceOnAllFinished: boolean
}

export const clubsKeys = {
  list: (serverId: string, libraryItemId: string) =>
    ['clubs', serverId, libraryItemId || 'mine'] as const,
  detail: (serverId: string, clubId: string, bookId: string) =>
    ['clubs', serverId, 'detail', clubId, bookId || 'current'] as const,
}

interface RawClubBook {
  libraryItemId?: string
  title?: string
  author?: string
  addedBy?: string
  startedAt?: number
  finishedAt?: number | null
  queuedAt?: number | null
  abandonedAt?: number | null
  sortOrder?: number
}

interface RawClub {
  id?: string
  name?: string
  createdBy?: string
  isOpen?: boolean
  visibility?: ClubVisibility
  archived?: boolean
  createdAt?: number
  lastActivityAt?: number
  memberCount?: number
  currentBook?: RawClubBook | null
  queuedItemIds?: string[]
  recBasis?: ClubRecBasis
  allowCommentEditing?: boolean
  allowReplies?: boolean
  autoAdvanceOnAllFinished?: boolean
}

function mapClubBook(b: RawClubBook): HSClubBook {
  return {
    libraryItemId: b.libraryItemId ?? '',
    title: b.title ?? '',
    author: b.author ?? '',
    addedBy: b.addedBy ?? '',
    startedAt: b.startedAt ?? 0,
    finishedAt: b.finishedAt ?? null,
    queuedAt: b.queuedAt ?? null,
    abandonedAt: b.abandonedAt ?? null,
    sortOrder: b.sortOrder ?? 0,
  }
}

function mapClub(c: RawClub): ClubSummary {
  return {
    id: c.id ?? '',
    name: c.name ?? '',
    createdBy: c.createdBy ?? '',
    visibility: c.visibility ?? (c.isOpen === false ? 'closed' : 'public'),
    isOpen: c.isOpen !== false,
    archived: Boolean(c.archived),
    createdAt: c.createdAt ?? 0,
    lastActivityAt: c.lastActivityAt ?? c.createdAt ?? 0,
    memberCount: c.memberCount ?? 0,
    currentBook: c.currentBook ? mapClubBook(c.currentBook) : null,
    queuedItemIds: Array.isArray(c.queuedItemIds) ? c.queuedItemIds : [],
    recBasis: c.recBasis ?? 'club-history',
    allowCommentEditing: c.allowCommentEditing ?? true,
    allowReplies: c.allowReplies ?? true,
    autoAdvanceOnAllFinished: c.autoAdvanceOnAllFinished ?? false,
  }
}

/**
 * The caller's clubs plus public clubs they can join. A libraryItemId narrows
 * discovery to clubs currently reading that item.
 */
export async function getClubs(
  t: AbsTarget,
  libraryItemId?: string,
  includeDirectory = false,
): Promise<HSClubsResponse> {
  const token = getAbsToken(t.serverId)
  if (!token) return CLUBS_DISABLED
  try {
    const params = new URLSearchParams()
    if (libraryItemId) params.set('libraryItemId', libraryItemId)
    if (includeDirectory) params.set('directory', '1')
    const qs = params.toString()
    const res = await fetch(`${origin(t)}/hs/clubs${qs ? `?${qs}` : ''}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) return CLUBS_DISABLED
    const data = (await res.json()) as {
      enabled?: boolean
      mine?: RawClub[]
      joinable?: RawClub[]
    }
    if (!data || data.enabled !== true) return CLUBS_DISABLED
    return {
      enabled: true,
      mine: (data.mine ?? []).map(mapClub).filter((club) => !club.archived),
      joinable: (data.joinable ?? []).map(mapClub).filter((club) => !club.archived),
    }
  } catch {
    return CLUBS_DISABLED
  }
}

export interface CreateClubInput {
  name: string
  libraryItemId?: string
  visibility?: ClubVisibility
}

export interface ClubInvitee {
  userId: string
  username: string
  pendingInviteId: string | null
}

export interface ClubInviteResult {
  userId: string
  inviteId?: string
  invited: boolean
  reason?: string
  emailSent?: boolean
  emailReason?: string | null
  pushed?: number
}

/** Create a club; the caller becomes owner. Throws on failure. */
export async function createClub(t: AbsTarget, input: CreateClubInput): Promise<HSClub> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/clubs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`clubs ${res.status}`)
  return mapClub((await res.json()) as RawClub)
}

export async function getClubInvitees(t: AbsTarget, clubId: string): Promise<ClubInvitee[]> {
  const token = getAbsToken(t.serverId)
  if (!token) return []
  const res = await fetch(`${origin(t)}/hs/clubs/${encodeURIComponent(clubId)}/invitees`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`club invitees ${res.status}`)
  const data = (await res.json()) as { users?: ClubInvitee[] }
  return Array.isArray(data.users) ? data.users : []
}

export async function inviteClubUsers(
  t: AbsTarget,
  clubId: string,
  userIds: string[],
): Promise<ClubInviteResult[]> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/clubs/${encodeURIComponent(clubId)}/invites`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body: JSON.stringify({ userIds }),
  })
  if (!res.ok) throw new Error(`club invites ${res.status}`)
  const data = (await res.json()) as { results?: ClubInviteResult[] }
  return Array.isArray(data.results) ? data.results : []
}

export async function respondToClubInvite(
  t: AbsTarget,
  clubId: string,
  inviteId: string,
  accept: boolean,
): Promise<void> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const action = accept ? 'accept' : 'decline'
  const res = await fetch(
    `${origin(t)}/hs/clubs/${encodeURIComponent(clubId)}/invites/${encodeURIComponent(inviteId)}/${action}`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
  )
  if (!res.ok) throw new Error(`club invite ${action} ${res.status}`)
}

export async function revokeClubInvite(
  t: AbsTarget,
  clubId: string,
  inviteId: string,
): Promise<void> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(
    `${origin(t)}/hs/clubs/${encodeURIComponent(clubId)}/invites/${encodeURIComponent(inviteId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(`club invite revoke ${res.status}`)
}

async function clubAction(
  t: AbsTarget,
  clubId: string,
  action: string,
  body?: unknown,
): Promise<void> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/clubs/${encodeURIComponent(clubId)}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`clubs ${action} ${res.status}`)
}

export const joinClub = (t: AbsTarget, clubId: string): Promise<void> =>
  clubAction(t, clubId, 'join')
export const leaveClub = (t: AbsTarget, clubId: string): Promise<void> =>
  clubAction(t, clubId, 'leave')
export const kickMember = (t: AbsTarget, clubId: string, userId: string): Promise<void> =>
  clubAction(t, clubId, 'kick', { userId })

export async function setClubVisibility(
  t: AbsTarget,
  clubId: string,
  visibility: ClubVisibility,
): Promise<void> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/clubs/${encodeURIComponent(clubId)}/visibility`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body: JSON.stringify({ visibility }),
  })
  if (!res.ok) throw new Error(`clubs visibility ${res.status}`)
}

export interface ClubPolicySettings {
  allowCommentEditing: boolean
  allowReplies: boolean
  autoAdvanceOnAllFinished: boolean
}

/** Owner-controlled discussion and reading-pace policy for one club. */
export async function setClubSettings(
  t: AbsTarget,
  clubId: string,
  settings: ClubPolicySettings,
): Promise<void> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/clubs/${encodeURIComponent(clubId)}/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body: JSON.stringify(settings),
  })
  if (!res.ok) throw new Error(`club settings ${res.status}`)
}
/**
 * Make a book the club's current read. The outgoing book becomes a past read
 * unless `finishPrevious` is false, which sets it aside unfinished instead so it
 * can come back via requeueClubBook.
 */
export const advanceClubBook = (
  t: AbsTarget,
  clubId: string,
  libraryItemId: string,
  finishPrevious = true,
): Promise<void> => clubAction(t, clubId, 'books', { libraryItemId, finishPrevious })
export const enqueueClubBook = (
  t: AbsTarget,
  clubId: string,
  libraryItemId: string,
): Promise<void> => clubAction(t, clubId, 'queue', { libraryItemId })
/** Move a past read or a set aside book back into the up-next queue. */
export const requeueClubBook = (
  t: AbsTarget,
  clubId: string,
  libraryItemId: string,
): Promise<void> => clubAction(t, clubId, 'requeue', { libraryItemId })

/** Rewrite the up-next queue order. Omitted queued books keep their relative
 * order at the back, so a stale list never drops a book. */
export async function reorderClubQueue(
  t: AbsTarget,
  clubId: string,
  libraryItemIds: string[],
): Promise<void> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/clubs/${encodeURIComponent(clubId)}/queue-order`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body: JSON.stringify({ libraryItemIds }),
  })
  if (!res.ok) throw new Error(`clubs queue-order ${res.status}`)
}

/** Owner-only removal of a book that has not been promoted from Up Next yet. */
export async function removeQueuedClubBook(
  t: AbsTarget,
  clubId: string,
  libraryItemId: string,
): Promise<void> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(
    `${origin(t)}/hs/clubs/${encodeURIComponent(clubId)}/queue/${encodeURIComponent(libraryItemId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    },
  )
  if (!res.ok) throw new Error(`clubs queue delete ${res.status}`)
}

/** Owner or admin archives the club. */
export async function archiveClub(t: AbsTarget, clubId: string): Promise<void> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/clubs/${encodeURIComponent(clubId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`clubs delete ${res.status}`)
}

/** Backward-compatible alias: this archives, it does not permanently delete. */
export const deleteClubLegacy = archiveClub

/** Owner or admin permanently deletes the club. */
export async function deleteClub(t: AbsTarget, clubId: string): Promise<void> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/clubs/${encodeURIComponent(clubId)}/hard`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`clubs hard delete ${res.status}`)
}

interface RawClubMember {
  userId?: string
  username?: string
  role?: 'owner' | 'member'
  joinedAt?: number
  currentTime?: number | null
  duration?: number | null
  isFinished?: boolean | null
  listeningNow?: boolean
  reach?: {
    index?: number
    total?: number
    libraryItemId?: string
    title?: string
    isFinished?: boolean
    aheadOfClub?: boolean
  } | null
}

function mapClubMember(m: RawClubMember): HSClubMember {
  return {
    userId: m.userId ?? '',
    username: m.username ?? '',
    role: m.role === 'owner' ? 'owner' : 'member',
    joinedAt: m.joinedAt ?? 0,
    currentTime: m.currentTime ?? null,
    duration: m.duration ?? null,
    isFinished: m.isFinished ?? null,
    listeningNow: Boolean(m.listeningNow),
    reach: m.reach
      ? {
          index: m.reach.index ?? 0,
          total: m.reach.total ?? 0,
          libraryItemId: m.reach.libraryItemId ?? '',
          title: m.reach.title ?? '',
          isFinished: Boolean(m.reach.isFinished),
          aheadOfClub: Boolean(m.reach.aheadOfClub),
        }
      : null,
  }
}

const EMPTY_CLUB: ClubSummary = {
  id: '',
  name: '',
  createdBy: '',
  visibility: 'public',
  isOpen: true,
  archived: false,
  createdAt: 0,
  lastActivityAt: 0,
  memberCount: 0,
  currentBook: null,
  queuedItemIds: [],
  recBasis: 'club-history',
  allowCommentEditing: true,
  allowReplies: true,
  autoAdvanceOnAllFinished: false,
}

const CLUB_DETAIL_DISABLED: HSClubDetail = {
  enabled: false,
  club: EMPTY_CLUB,
  books: [],
  queue: [],
  members: [],
  notes: { notes: [], locked: [], hiddenAhead: 0 },
  unreadCount: 0,
}

/**
 * Full club detail: history, members with progress in the viewed book
 * (defaults to the current book), gated notes, and the unread count.
 */
export async function getClubDetail(
  t: AbsTarget,
  clubId: string,
  opts: { bookId?: string; position?: number } = {},
): Promise<HSClubDetail> {
  const token = getAbsToken(t.serverId)
  if (!token) return CLUB_DETAIL_DISABLED
  try {
    const qs = new URLSearchParams()
    if (opts.bookId) qs.set('bookId', opts.bookId)
    if (opts.position != null) qs.set('position', String(opts.position))
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    const res = await fetch(`${origin(t)}/hs/clubs/${encodeURIComponent(clubId)}${suffix}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) return CLUB_DETAIL_DISABLED
    const data = (await res.json()) as {
      enabled?: boolean
      club?: RawClub
      books?: RawClubBook[]
      queue?: RawClubBook[]
      members?: RawClubMember[]
      notes?: {
        notes?: RawNote[]
        locked?: Array<{ id?: string; timeSec?: number }>
        hiddenAhead?: number
      }
      unreadCount?: number
    }
    if (!data || data.enabled !== true || !data.club) return CLUB_DETAIL_DISABLED
    return {
      enabled: true,
      club: mapClub(data.club),
      books: (data.books ?? []).map(mapClubBook),
      queue: (data.queue ?? []).map(mapClubBook),
      members: (data.members ?? []).map(mapClubMember),
      notes: {
        notes: (data.notes?.notes ?? []).map(mapNote),
        locked: (data.notes?.locked ?? []).map((s) => ({
          id: s.id ?? '',
          timeSec: s.timeSec ?? 0,
        })),
        hiddenAhead: data.notes?.hiddenAhead ?? 0,
      },
      unreadCount: data.unreadCount ?? 0,
    }
  } catch {
    return CLUB_DETAIL_DISABLED
  }
}

/** Bump the club's unread cursor. Server applies max(stored, incoming). */
export async function markClubRead(
  t: AbsTarget,
  clubId: string,
  lastReadAt: number,
): Promise<void> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/clubs/${encodeURIComponent(clubId)}/read`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body: JSON.stringify({ lastReadAt }),
  })
  if (!res.ok) throw new Error(`clubs read ${res.status}`)
}
