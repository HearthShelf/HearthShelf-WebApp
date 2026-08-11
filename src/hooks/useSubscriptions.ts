/**
 * Release subscriptions ("follow") for the active server. A follow is how a user
 * asks to be told about a book that doesn't exist in the library yet: either one
 * upcoming book, or a whole series (which covers every future book in it).
 *
 * Distinct from RMAB's watch lists (useRmab): those auto-REQUEST a download when
 * something appears, and only exist when the request backend is connected. A
 * follow is HearthShelf-owned, always available, and only notifies.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import {
  getSubscriptions,
  createSubscription,
  deleteSubscription,
  subscriptionKeys,
} from '@/api/absSubscriptions'
import type { HSSubscription, HSSubscriptionCreate } from '@hearthshelf/core'

export function useSubscriptions() {
  const { target } = useActiveServer()
  return useQuery<HSSubscription[]>({
    queryKey: subscriptionKeys.list(target?.serverId ?? ''),
    queryFn: () => (target ? getSubscriptions(target) : Promise.resolve([])),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
}

/** Look up an existing follow for a book ASIN / a series ASIN, so a control can
 *  render as already-followed and unfollow without a second lookup. */
export function useFollowLookup() {
  const { data: subs } = useSubscriptions()
  const list = subs ?? []
  return {
    bookSub: (asin: string | undefined | null) =>
      asin ? list.find((s) => s.kind === 'book' && s.asin === asin) : undefined,
    seriesSub: (seriesAsin: string | undefined | null) =>
      seriesAsin ? list.find((s) => s.kind === 'series' && s.seriesAsin === seriesAsin) : undefined,
  }
}

function useInvalidateSubscriptions() {
  const qc = useQueryClient()
  const { target } = useActiveServer()
  return () => {
    void qc.invalidateQueries({ queryKey: subscriptionKeys.list(target?.serverId ?? '') })
  }
}

export function useFollow() {
  const { target } = useActiveServer()
  const invalidate = useInvalidateSubscriptions()
  return useMutation({
    mutationFn: (body: HSSubscriptionCreate) => {
      if (!target) throw new Error('No server connected')
      return createSubscription(target, body)
    },
    onSuccess: invalidate,
  })
}

export function useUnfollow() {
  const { target } = useActiveServer()
  const invalidate = useInvalidateSubscriptions()
  return useMutation({
    mutationFn: (id: string) => {
      if (!target) throw new Error('No server connected')
      return deleteSubscription(target, id)
    },
    onSuccess: invalidate,
  })
}
