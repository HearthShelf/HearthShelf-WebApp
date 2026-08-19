import { getAbsToken } from '@/lib/absTokens'
import { getLibraries, searchLibrary, type AbsTarget } from './absLibrary'
import { getBookDetailFull } from './absBookDetail'

function origin(target: AbsTarget): string {
  return target.serverUrl.replace(/\/$/, '')
}

export interface HSNotification {
  id: string
  kind: string
  entityId: string
  title: string
  body: string
  data: Record<string, unknown>
  createdAt: number
  readAt: number | null
  actionStatus: string | null
}

export interface NotificationsResponse {
  notifications: HSNotification[]
  unreadCount: number
}

const EMPTY: NotificationsResponse = { notifications: [], unreadCount: 0 }

export const notificationKeys = {
  list: (serverId: string) => ['notifications', serverId] as const,
}

export async function getNotifications(target: AbsTarget): Promise<NotificationsResponse> {
  const token = getAbsToken(target.serverId)
  if (!token) return EMPTY
  try {
    const response = await fetch(`${origin(target)}/hs/notifications`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!response.ok) return EMPTY
    const data = (await response.json()) as Partial<NotificationsResponse>
    return {
      notifications: Array.isArray(data.notifications) ? data.notifications : [],
      unreadCount: Number(data.unreadCount) || 0,
    }
  } catch {
    return EMPTY
  }
}

export async function markNotificationRead(target: AbsTarget, id: string): Promise<void> {
  const token = getAbsToken(target.serverId)
  if (!token) throw new Error('no token')
  const response = await fetch(
    `${origin(target)}/hs/notifications/${encodeURIComponent(id)}/read`,
    { method: 'PUT', headers: { Authorization: `Bearer ${token}` } },
  )
  if (!response.ok) throw new Error(`notification read ${response.status}`)
}

export async function markAllNotificationsRead(target: AbsTarget): Promise<void> {
  const token = getAbsToken(target.serverId)
  if (!token) throw new Error('no token')
  const response = await fetch(`${origin(target)}/hs/notifications/read-all`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`notifications read-all ${response.status}`)
}

async function remove(target: AbsTarget, path: string, label: string): Promise<void> {
  const token = getAbsToken(target.serverId)
  if (!token) throw new Error('no token')
  const response = await fetch(`${origin(target)}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`${label} ${response.status}`)
}

/** Dismiss one notification. */
export function deleteNotification(target: AbsTarget, id: string): Promise<void> {
  return remove(target, `/hs/notifications/${encodeURIComponent(id)}`, 'notification delete')
}

/** Clear the whole inbox. */
export function deleteAllNotifications(target: AbsTarget): Promise<void> {
  return remove(target, '/hs/notifications', 'notifications delete-all')
}

/**
 * Find the owned library item for an Audible ASIN, or null when it isn't in the
 * library. ABS has no by-ASIN endpoint, so this searches (ABS indexes the ASIN)
 * and CONFIRMS against the item detail - a bare ASIN can substring-match a
 * description, and opening the wrong book is worse than not resolving one.
 * Best-effort: every failure returns null so callers fall back.
 */
export async function findOwnedItemByAsin(
  target: AbsTarget,
  asin: string,
): Promise<string | null> {
  const wanted = asin.trim().toLowerCase()
  if (!wanted) return null
  try {
    const libraries = await getLibraries(target)
    for (const library of libraries) {
      const hits = await searchLibrary(target, library.id, asin, 5)
      for (const hit of hits) {
        try {
          const detail = await getBookDetailFull(target, hit.id)
          if ((detail.asin ?? '').trim().toLowerCase() === wanted) return hit.id
        } catch {
          // Unreadable item - try the next hit.
        }
      }
    }
  } catch {
    // Offline or refused - caller falls back to the upcoming page.
  }
  return null
}
