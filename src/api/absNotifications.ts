import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from './absLibrary'

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
