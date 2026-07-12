/**
 * Auto-source dismissals sync against the active server's HearthShelf backend
 * (/hs/dismissals). Same rails as absQueue.ts: the connected server's origin +
 * the per-server ABS bearer token, keyed server-side by (server_id, user_id) so
 * the "not right now" list follows the user across devices.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from '@/api/absLibrary'
import type { Dismissals } from '@hearthshelf/core'

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

async function dismissalsFetch(t: AbsTarget, options: RequestInit = {}): Promise<Dismissals> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no_token')
  const res = await fetch(`${origin(t)}/hs/dismissals`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  if (!res.ok) throw new Error(`dismissals ${res.status}`)
  return res.json() as Promise<Dismissals>
}

export function getServerDismissals(t: AbsTarget): Promise<Dismissals> {
  return dismissalsFetch(t)
}

export function addServerDismissal(
  t: AbsTarget,
  kind: 'series' | 'item',
  entityId: string,
): Promise<Dismissals> {
  return dismissalsFetch(t, { method: 'POST', body: JSON.stringify({ kind, entityId }) })
}

export function removeServerDismissal(
  t: AbsTarget,
  kind: 'series' | 'item',
  entityId: string,
): Promise<Dismissals> {
  return dismissalsFetch(t, { method: 'DELETE', body: JSON.stringify({ kind, entityId }) })
}
