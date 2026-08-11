/**
 * Release subscriptions against the connected server's HearthShelf backend
 * (/hs/subscriptions). Reached like the other /hs clients: the server's public
 * origin + the per-server ABS bearer token.
 *
 * Reads degrade to an empty list on any failure so the Home banner quietly hides
 * rather than breaking Home. Writes throw, so the caller can surface the failure
 * instead of silently showing an un-followed book as followed.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from './absLibrary'
import type {
  HSSubscription,
  HSSubscriptionCreate,
  HSSubscriptionsResponse,
} from '@hearthshelf/core'

export const subscriptionKeys = {
  list: (serverId: string) => ['subscriptions', serverId] as const,
}

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

export async function getSubscriptions(t: AbsTarget): Promise<HSSubscription[]> {
  const token = getAbsToken(t.serverId)
  if (!token) return []
  try {
    const res = await fetch(`${origin(t)}/hs/subscriptions`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return []
    const data = (await res.json()) as HSSubscriptionsResponse
    return data.subscriptions ?? []
  } catch {
    return []
  }
}

function authHeaders(t: AbsTarget): Record<string, string> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('Not signed in to this server')
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

/** Follow an upcoming book, or a whole series (every future book in it). The
 *  server upserts, so following twice is harmless. */
export async function createSubscription(
  t: AbsTarget,
  body: HSSubscriptionCreate,
): Promise<HSSubscription> {
  const res = await fetch(`${origin(t)}/hs/subscriptions`, {
    method: 'POST',
    headers: authHeaders(t),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Could not follow (${res.status})`)
  const data = (await res.json()) as { subscription: HSSubscription }
  return data.subscription
}

/** Unfollow, by subscription id. */
export async function deleteSubscription(t: AbsTarget, id: string): Promise<void> {
  const res = await fetch(`${origin(t)}/hs/subscriptions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(t),
  })
  if (!res.ok) throw new Error(`Could not unfollow (${res.status})`)
}
