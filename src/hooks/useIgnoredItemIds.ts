/**
 * The library item ids belonging to series the user has ignored.
 *
 * The taste engine (Discover, QuestGiver) sees only the minified item shape,
 * whose metadata carries a `seriesName` string and no series id - so it cannot
 * test the ignore list itself. The /series endpoint is the only join: its
 * `books` array inverts to item -> series. This resolves that once, so the
 * recommendation builders can take a flat id set.
 *
 * Ignore is not hide: these ids still render everywhere the user browses. Only
 * the surfaces that SUGGEST a book skip them.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ignoredItemIds } from '@hearthshelf/core'
import { getSeries } from '@/api/absLibrary'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { useIgnoredSeriesIds } from '@/hooks/useIgnoredBooks'

const EMPTY: ReadonlySet<string> = new Set()

export function useIgnoredItemIds(enabled = true): ReadonlySet<string> {
  const { target } = useActiveServer()
  const { activeId } = useActiveLibrary()
  const ignoredSeries = useIgnoredSeriesIds()

  // Only pay for the series fetch when something is actually ignored - on the
  // common path (no ignores) this hook costs nothing.
  const wanted = enabled && ignoredSeries.length > 0
  const { data } = useQuery({
    queryKey: ['home-series', target?.serverId ?? '', activeId ?? ''],
    queryFn: () => getSeries(target!, activeId as string),
    enabled: wanted && Boolean(target) && Boolean(activeId),
    staleTime: 2 * 60 * 1000,
  })

  return useMemo(() => {
    if (!wanted) return EMPTY
    return ignoredItemIds(data?.results ?? [], { seriesIds: ignoredSeries, itemIds: [] })
  }, [wanted, data, ignoredSeries])
}
