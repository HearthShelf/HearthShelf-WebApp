/**
 * Discover hooks for the active server. Config drives the nav item + route gate;
 * the data hooks (monthly AI shelf, per-item feedback, popular signals) all hit
 * the active server's /hs/discover* backend and degrade gracefully (see
 * absDiscover.ts), so the page never breaks when the backend is absent.
 */
import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import {
  getDiscoverConfig,
  getMonthlyShelf,
  getDiscoverFeedback,
  setDiscoverFeedback,
  getPopular,
  type DiscoverConfig,
  type DiscoverFeedbackMap,
  type DiscoverVote,
  type MonthlyShelf,
  type PopularItem,
} from '@/api/absDiscover'
import { buildDiscoverSummary, discoverCandidates } from '@hearthshelf/core'
import type { AbsLibraryItem, MediaProgress } from '@/api/absLibrary'

const NO_TARGET: DiscoverConfig = { enabled: false }

// Shared Discover config query - drives the nav item and the route gate.
export function useDiscoverConfig() {
  const { target } = useActiveServer()
  return useQuery<DiscoverConfig>({
    queryKey: ['discover', 'config', target?.serverId],
    queryFn: () => (target ? getDiscoverConfig(target) : Promise.resolve(NO_TARGET)),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
}

// True only when the backend reports Discover enabled. Defaults to false until
// known, so the nav item doesn't flicker in on a server without the feature.
export function useDiscoverEnabled(): boolean {
  const { data } = useDiscoverConfig()
  return data?.enabled === true
}

// The month's AI-curated shelf. Long staleTime - it only changes once a month.
export function useMonthlyShelf(
  items: AbsLibraryItem[],
  progressById: Map<string, MediaProgress>,
  enabled: boolean
) {
  const { target } = useActiveServer()
  const summary = useMemo(
    () => buildDiscoverSummary(items, progressById),
    [items, progressById]
  )
  const candidates = useMemo(
    () => discoverCandidates(items, progressById),
    [items, progressById]
  )
  return useQuery<MonthlyShelf>({
    queryKey: ['discover', 'monthly', target?.serverId, summary, candidates.length],
    queryFn: () =>
      target
        ? getMonthlyShelf(target, summary, candidates)
        : Promise.resolve<MonthlyShelf>({ month: '', engine: 'none', intro: '', picks: [] }),
    enabled: enabled && Boolean(target) && candidates.length > 0,
    staleTime: 60 * 60 * 1000,
  })
}

export function useDiscoverFeedbackQuery(enabled: boolean) {
  const { target } = useActiveServer()
  return useQuery<DiscoverFeedbackMap>({
    queryKey: ['discover', 'feedback', target?.serverId],
    queryFn: () => (target ? getDiscoverFeedback(target) : Promise.resolve({})),
    enabled: enabled && Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
}

// Upserts feedback and optimistically updates the cached map so the UI (e.g.
// hiding a not_interested tile) reacts immediately, before the round-trip.
export function useSetDiscoverFeedback() {
  const { target } = useActiveServer()
  const qc = useQueryClient()
  const key = ['discover', 'feedback', target?.serverId]
  return useMutation({
    mutationFn: ({
      itemKey,
      vote,
      rating,
    }: {
      itemKey: string
      vote?: DiscoverVote | null
      rating?: number | null
    }) =>
      target
        ? setDiscoverFeedback(target, itemKey, { vote, rating })
        : Promise.resolve<DiscoverFeedbackMap>({}),
    onMutate: async ({ itemKey, vote, rating }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<DiscoverFeedbackMap>(key) ?? {}
      const next: DiscoverFeedbackMap = { ...prev }
      const entry = { ...(next[itemKey] ?? {}) }
      if (vote !== undefined) {
        if (vote === null) delete entry.vote
        else entry.vote = vote
      }
      if (rating !== undefined) {
        if (rating === null) delete entry.rating
        else entry.rating = rating
      }
      if (Object.keys(entry).length === 0) delete next[itemKey]
      else next[itemKey] = entry
      qc.setQueryData(key, next)
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
    },
    onSuccess: (map) => {
      // The backend echoes the full map only when reachable; ignore an empty
      // echo (a degraded write) so we keep the optimistic state.
      if (map && Object.keys(map).length > 0) qc.setQueryData(key, map)
    },
  })
}

export function usePopular(enabled: boolean) {
  const { target } = useActiveServer()
  return useQuery<PopularItem[]>({
    queryKey: ['discover', 'popular', target?.serverId],
    queryFn: () => (target ? getPopular(target) : Promise.resolve([])),
    enabled: enabled && Boolean(target),
    staleTime: 60 * 60 * 1000,
  })
}
