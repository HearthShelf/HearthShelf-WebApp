/**
 * Typed ABS playback reads for the full-screen player: bookmarks (user-scoped,
 * per item). Listening sessions for "recent listens" reuse getListeningSessions
 * from absLibrary; item detail reuses getItemDetail from absLibrary.
 *
 * Field shapes verified against audiobookshelf 2.x serializers. Bookmarks live on
 * the user record (/api/me -> bookmarks[]); create/delete go through the
 * per-item bookmark routes. Times are whole seconds.
 */
import { absGet, absPost, absDelete, absMediaUrl } from './absClient'
import type { AbsTarget } from './absLibrary'
import type { ABSBookmark, ABSDeviceInfo } from '@hearthshelf/core'

export type AbsBookmark = ABSBookmark

interface RawBookmark {
  libraryItemId: string
  title?: string
  time?: number
  createdAt?: number
}

interface RawMeBookmarks {
  bookmarks?: RawBookmark[]
}

function mapBookmark(b: RawBookmark, fallbackItemId = '', fallbackTime = 0): AbsBookmark {
  return {
    libraryItemId: b.libraryItemId ?? fallbackItemId,
    title: b.title || '',
    time: b.time ?? fallbackTime,
    createdAt: b.createdAt ?? 0,
  }
}

/**
 * Every bookmark for this user (across all items). The player filters to the
 * playing item. ABS has no per-item bookmark GET, so we read /api/me once.
 */
export async function getBookmarks(t: AbsTarget): Promise<AbsBookmark[]> {
  const data = await absGet<RawMeBookmarks>(t, '/api/me')
  return (data.bookmarks ?? []).map((b) => mapBookmark(b))
}

/**
 * Create a bookmark at a position. POST /api/me/item/:id/bookmark with
 * { time, title }. Returns the created bookmark.
 */
export async function createBookmark(
  t: AbsTarget,
  libraryItemId: string,
  time: number,
  title: string,
): Promise<AbsBookmark> {
  const b = await absPost<RawBookmark>(
    t,
    `/api/me/item/${encodeURIComponent(libraryItemId)}/bookmark`,
    { time: Math.round(time), title },
  )
  return b
    ? mapBookmark(b, libraryItemId, Math.round(time))
    : { libraryItemId, title, time: Math.round(time), createdAt: Date.now() }
}

/**
 * Delete a bookmark by its position. DELETE /api/me/item/:id/bookmark/:time
 * (time is whole seconds).
 */
export async function deleteBookmark(
  t: AbsTarget,
  libraryItemId: string,
  time: number,
): Promise<void> {
  await absDelete(
    t,
    `/api/me/item/${encodeURIComponent(libraryItemId)}/bookmark/${Math.round(time)}`,
  )
}

/** Tokenized ebook file URL, when an item carries one (reader is deferred). */
export function ebookFileUrl(t: AbsTarget, itemId: string): string | null {
  return absMediaUrl(t, `/api/items/${encodeURIComponent(itemId)}/ebook`)
}

// --- recent listening sessions (for the "recent listens" panel) -------------

/**
 * A listening session with the position fields the player's recent-listens panel
 * needs (start/current position to jump back to). absLibrary's mapped session
 * shape drops these, so the player reads the raw ABS shape here.
 */
export interface RecentSession {
  id: string
  libraryItemId: string
  /** Seconds into the book where this session started (the jump target). */
  startTime: number
  /** Seconds into the book where this session left off. */
  currentTime: number
  /** Seconds actually listened in this session. */
  timeListening: number
  /** Epoch ms the session started. */
  startedAt: number
  deviceInfo?: ABSDeviceInfo
}

interface RawRecentSession {
  id: string
  libraryItemId: string
  startTime?: number
  currentTime?: number
  timeListening?: number
  startedAt?: number
  deviceInfo?: ABSDeviceInfo
}

interface RawRecentSessionsResponse {
  sessions?: RawRecentSession[]
}

export async function getRecentSessions(
  t: AbsTarget,
  itemsPerPage = 100,
): Promise<RecentSession[]> {
  const data = await absGet<RawRecentSessionsResponse>(
    t,
    `/api/me/listening-sessions?page=0&itemsPerPage=${itemsPerPage}`,
  )
  return (data.sessions ?? []).map((s) => ({
    id: s.id,
    libraryItemId: s.libraryItemId,
    startTime: s.startTime ?? 0,
    currentTime: s.currentTime ?? 0,
    timeListening: s.timeListening ?? 0,
    startedAt: s.startedAt ?? 0,
    deviceInfo: s.deviceInfo,
  }))
}
