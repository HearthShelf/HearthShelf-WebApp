/**
 * The user's own star ratings, against the connected server's HearthShelf
 * backend. Like absDiscover.ts these live under /hs/* on the server's own origin
 * (NOT the ABS-native /api/* surface), reached with the per-server ABS token.
 *
 * Unlike absDiscover.ts, failures are NOT swallowed into a neutral value: a
 * rating write that quietly failed would leave the optimistic UI showing a score
 * the server never stored. The mutation's rollback depends on this throwing.
 *
 * Note this endpoint is deliberately not behind the Discover feature flag -
 * ratings show on the book page and elsewhere regardless of Discover.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from './absLibrary'
import type { HSRatingMap } from '@hearthshelf/core'

export type RatingMap = HSRatingMap

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

async function rFetch<T>(t: AbsTarget, options: RequestInit = {}): Promise<T> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/ratings`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  if (!res.ok) {
    let error = `Ratings ${res.status}`
    try {
      const body = await res.json()
      if (body?.error) error = body.error
    } catch {
      // non-JSON error body; keep the generic message
    }
    throw new Error(error)
  }
  return res.json() as Promise<T>
}

export async function getRatings(t: AbsTarget): Promise<RatingMap> {
  const r = await rFetch<{ ratings: RatingMap }>(t)
  return r.ratings ?? {}
}

/** `rating: null` clears. Returns the full server map to adopt. */
export async function setRating(
  t: AbsTarget,
  itemKey: string,
  rating: number | null,
): Promise<RatingMap> {
  const r = await rFetch<{ ratings: RatingMap }>(t, {
    method: 'PUT',
    body: JSON.stringify({ itemKey, rating }),
  })
  return r.ratings ?? {}
}
