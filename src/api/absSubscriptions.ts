/**
 * Release subscriptions against the connected server's HearthShelf backend
 * (/hs/subscriptions). Reached like the other /hs clients: the server's public
 * origin + the per-server ABS bearer token.
 *
 * Read-only for now - Home's countdown banner is the only consumer, and it just
 * needs the followed-books list. Degrades to an empty list on any failure so the
 * banner quietly hides rather than breaking Home.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from './absLibrary'
import type { HSSubscription, HSSubscriptionsResponse } from '@hearthshelf/core'

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
