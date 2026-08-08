/**
 * The user's own star ratings for the active server. One shared query key per
 * server, so rating a book on the series page updates the book page, the
 * finished-books page, and Discover with no refetch.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getRatings, setRating, type RatingMap } from '@/api/absRatings'

export function useRatings(enabled = true) {
  const { target } = useActiveServer()
  return useQuery<RatingMap>({
    queryKey: ['ratings', 'map', target?.serverId],
    queryFn: () => (target ? getRatings(target) : Promise.resolve({})),
    enabled: enabled && Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
}

// Optimistic: the stars fill on click and roll back if the write fails.
export function useSetRating() {
  const { target } = useActiveServer()
  const qc = useQueryClient()
  const key = ['ratings', 'map', target?.serverId]
  return useMutation({
    mutationFn: ({ itemKey, rating }: { itemKey: string; rating: number | null }) =>
      target ? setRating(target, itemKey, rating) : Promise.resolve<RatingMap>({}),
    onMutate: async ({ itemKey, rating }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<RatingMap>(key) ?? {}
      const next: RatingMap = { ...prev }
      if (rating === null) delete next[itemKey]
      else next[itemKey] = rating
      qc.setQueryData(key, next)
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
    },
    onSuccess: (map) => qc.setQueryData(key, map),
  })
}
