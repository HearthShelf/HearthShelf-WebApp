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

/** The server's stored queue. A plain GET no longer recomputes (that's now
 *  trigger-based - see recomputeServerQueue), so this is a cheap read used for
 *  foreground refresh and cross-device pulls. */
export function getServerQueue(t: AbsTarget): Promise<QueueState> {
  return queueFetch<QueueState>(t, '/hs/queue')
}

/** Ask the server to rebuild the Auto queue now and return it. Called on the
 *  triggers (play-cooldown, settings/manual/dismissal edits) instead of on every
 *  read. `currentItemId` is the book now playing; the server seeds finish-series
 *  from it and stores it for the nightly rebuild. */
export function recomputeServerQueue(
  t: AbsTarget,
  currentItemId?: string | null,
): Promise<QueueState> {
  return queueFetch<QueueState>(t, '/hs/queue/recompute', {
    method: 'POST',
    body: JSON.stringify(currentItemId === undefined ? {} : { currentItemId }),
  })
}

/** Push the (Manual) queue. The server LWW-guards on updatedAt and returns the
 *  row that ended up stored plus whether the write applied. */
export function putServerQueue(
  t: AbsTarget,
  items: QueueState['items'],
  manual: QueueState['manual'],
  playlistId: string | null,
  updatedAt: number,
): Promise<QueuePushResult> {
  return queueFetch<QueuePushResult>(t, '/hs/queue', {
    method: 'PUT',
    body: JSON.stringify({ items, manual, playlistId, updatedAt }),
  })
}
