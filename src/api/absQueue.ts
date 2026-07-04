/**
 * Listening-queue sync against the active server's HearthShelf backend
 * (/hs/queue). Same rails as absSettings.ts: the connected server's own origin +
 * the per-server ABS bearer token, keyed server-side by (server_id, user_id) so
 * every device sees the same queue.
 *
 * The server OWNS the queue: in Auto mode a GET returns a freshly computed list
 * (from the user's rules + ABS library/progress + club picks); this client only
 * pulls that and, for Manual mode, pushes the hand-ordered list back.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from '@/api/absLibrary'
import type { QueueState } from '@hearthshelf/core'

export interface QueuePushResult extends QueueState {
  applied: boolean
}

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

async function queueFetch<T>(t: AbsTarget, path: string, options: RequestInit = {}): Promise<T> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no_token')
  const res = await fetch(`${origin(t)}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  if (!res.ok) throw new Error(`queue ${res.status}`)
  return res.json() as Promise<T>
}

/** The server's current queue (computed for Auto mode, stored otherwise). */
export function getServerQueue(t: AbsTarget): Promise<QueueState> {
  return queueFetch<QueueState>(t, '/hs/queue')
}

/** Push the (Manual) queue. The server LWW-guards on updatedAt and returns the
 *  row that ended up stored plus whether the write applied. */
export function putServerQueue(
  t: AbsTarget,
  items: QueueState['items'],
  playlistId: string | null,
  updatedAt: number,
): Promise<QueuePushResult> {
  return queueFetch<QueuePushResult>(t, '/hs/queue', {
    method: 'PUT',
    body: JSON.stringify({ items, playlistId, updatedAt }),
  })
}
