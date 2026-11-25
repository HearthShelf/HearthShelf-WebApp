import { useEffect, useRef } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { probeDuplicateIndex, carryOverOwnProgress, groupsFromIndex } from '@/api/absDuplicates'
import { learnDuplicates, useDuplicateIndex } from '@/lib/duplicates'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import type { AbsTarget } from '@/api/absLibrary'

// Lists whose fetchers hide duplicates: refetched once when new pairs are
// learned, so a pair found by the probe disappears from shelves already loaded.
// The full-library lists are left out: they find every pair themselves.
const LIST_KEYS = [
  'abs-home-shelves',
  'abs-items-in-progress',
  'abs-shelves',
  'abs-items',
  'abs-search',
  'abs-search-full',
  'abs-author',
  'home-series',
]

/**
 * Keeps the active server's duplicate map current and moves the listener's own
 * place onto the copies being kept. Mounted once, inside the connected server
 * shell (ActiveServerMediaUI).
 *
 * - Probes each book library for duplicates (issues filter + title search),
 *   at most every 10 minutes.
 * - When the map gains pairs: refetch the lists that hide them, then carry the
 *   signed-in user's progress and bookmarks (once per change; the planner is
 *   idempotent, so a repeat finds nothing to do).
 */
export function useDuplicateWatch(target: AbsTarget) {
  const qc = useQueryClient()
  const { libraries } = useActiveLibrary()
  const books = libraries.filter((l) => l.mediaType !== 'podcast')

  const probeData = useQueries({
    queries: books.map((lib) => ({
      queryKey: ['abs-duplicates', target.serverId, lib.id],
      queryFn: () => probeDuplicateIndex(target, lib.id),
      staleTime: 10 * 60 * 1000,
      retry: false,
    })),
    combine: (results) => results.map((r) => r.data),
  })
  useEffect(() => {
    for (const found of probeData) if (found) learnDuplicates(target.serverId, found)
  }, [target.serverId, probeData])

  const index = useDuplicateIndex(target.serverId)
  const lastCarried = useRef<string>('')
  useEffect(() => {
    const signature = Object.entries(index)
      .map(([d, k]) => `${d}>${k}`)
      .sort()
      .join(',')
    if (!signature || signature === lastCarried.current) return
    lastCarried.current = signature
    for (const key of LIST_KEYS) void qc.invalidateQueries({ queryKey: [key, target.serverId] })
    void carryOverOwnProgress(target, groupsFromIndex(index))
      .then((moved) => {
        if (moved.movedProgress || moved.movedBookmarks) {
          void qc.invalidateQueries({ queryKey: ['abs-media-progress', target.serverId] })
          void qc.invalidateQueries({ queryKey: ['abs-items-in-progress', target.serverId] })
          void qc.invalidateQueries({ queryKey: ['abs-bookmarks', target.serverId] })
        }
      })
      .catch(() => {
        // Try again on the next change or session; nothing was half-written that
        // the planner would not redo.
        lastCarried.current = ''
      })
  }, [index, qc, target])
}
