/**
 * Ignored roster books: Audible lists things in a series that will never be
 * audiobooks - ebook-only side stories, print editions, box sets. Ignoring one
 * drops it from the missing list, the series completion denominator, Upcoming,
 * and the Home countdown.
 *
 * Stored as a 'roster' dismissal keyed by Audible ASIN (these books have no ABS
 * item id - they are not in the library and may never be), so the choice
 * follows the user across devices.
 *
 * Filtering is deliberately client-side: the series roster is cached GLOBALLY
 * per server (its `owned` flags are a library-wide fact) while dismissals are
 * per-user, so the server must not bake one user's ignores into a shared roster.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import {
  getServerDismissals,
  addServerDismissal,
  removeServerDismissal,
} from '@/api/absDismissals'
import type { Dismissals } from '@hearthshelf/core'

const EMPTY: Dismissals = { seriesIds: [], itemIds: [], rosterAsins: [] }

export function dismissalKeys(serverId: string | undefined) {
  return ['dismissals', serverId ?? ''] as const
}

export function useDismissals() {
  const { target } = useActiveServer()
  return useQuery<Dismissals>({
    queryKey: dismissalKeys(target?.serverId),
    // Degrade to "nothing ignored" rather than throwing the page down: an older
    // server without /hs/dismissals should still render the series normally.
    queryFn: () => getServerDismissals(target!).catch(() => EMPTY),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
}

/** The ignored ASINs, ready to hand to core's roster helpers. */
export function useIgnoredAsins(): string[] {
  const { data } = useDismissals()
  return data?.rosterAsins ?? []
}

export function useIgnoreBook() {
  const { target } = useActiveServer()
  const qc = useQueryClient()
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: dismissalKeys(target?.serverId) })
  }
  const ignore = useMutation({
    mutationFn: (asin: string) => {
      if (!target) throw new Error('No server connected')
      return addServerDismissal(target, 'roster', asin)
    },
    onSuccess: invalidate,
  })
  const unignore = useMutation({
    mutationFn: (asin: string) => {
      if (!target) throw new Error('No server connected')
      return removeServerDismissal(target, 'roster', asin)
    },
    onSuccess: invalidate,
  })
  return { ignore, unignore, busy: ignore.isPending || unignore.isPending }
}
