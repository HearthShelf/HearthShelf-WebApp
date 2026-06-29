/**
 * ReadMeABook (RMAB) request hooks for the active server. Every call is scoped to
 * the ambient active server's HearthShelf backend (/hs/rmab/*) and degrades
 * gracefully (see absRequests.ts), so these never throw the page down.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import {
  getRmabConfig,
  listRequests,
  submitRequest,
  cancelRequest,
  retryRequest,
  fetchEbook,
  watchAuthor,
  unwatchAuthor,
  watchSeries,
  unwatchSeries,
  listWatchedAuthors,
  listWatchedSeries,
  type RmabConfig,
} from '@/api/absRequests'
import type { AbsTarget } from '@/api/absLibrary'

const NO_TARGET: RmabConfig = { enabled: false }

// Shared RMAB config query - drives the Requests nav item and the route gate.
export function useRmabConfig() {
  const { target } = useActiveServer()
  return useQuery<RmabConfig>({
    queryKey: ['rmab', 'config', target?.serverId],
    queryFn: () => (target ? getRmabConfig(target) : Promise.resolve(NO_TARGET)),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
}

// True only when the backend reports the request layer enabled. Defaults to
// false until known (the feature is opt-in), so nothing flickers into the nav.
export function useRmabEnabled(): boolean {
  const { data } = useRmabConfig()
  return data?.enabled === true
}

// Invalidate every request list + search lane so a write reflects immediately.
function useInvalidateRequests() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['rmab', 'requests'] })
    void qc.invalidateQueries({ queryKey: ['rmab', 'search'] })
  }
}

// A small helper that binds a write to the active server target. Resolves to a
// safe failure when no server is connected.
function useTargetMutation<TArgs, TResult>(
  fn: (t: AbsTarget, args: TArgs) => Promise<TResult>,
  fallback: TResult
) {
  const { target } = useActiveServer()
  const invalidate = useInvalidateRequests()
  return useMutation({
    mutationFn: (args: TArgs) =>
      target ? fn(target, args) : Promise.resolve(fallback),
    onSuccess: invalidate,
  })
}

export function useSubmitRequest() {
  return useTargetMutation(
    (t, audiobook: Parameters<typeof submitRequest>[1]) => submitRequest(t, audiobook),
    { success: false } as Awaited<ReturnType<typeof submitRequest>>
  )
}

export function useCancelRequest() {
  return useTargetMutation((t, id: string) => cancelRequest(t, id), { success: false })
}

export function useRetryRequest() {
  return useTargetMutation((t, id: string) => retryRequest(t, id), { success: false })
}

export function useFetchEbook() {
  return useTargetMutation((t, id: string) => fetchEbook(t, id), { success: false })
}

// Watch lists (auto-request new releases from an author / series).
export function useWatchedAuthors(enabled = true) {
  const { target } = useActiveServer()
  return useQuery({
    queryKey: ['rmab', 'watched-authors', target?.serverId],
    queryFn: () =>
      target ? listWatchedAuthors(target) : Promise.resolve({ success: false, authors: [] }),
    enabled: enabled && Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
}

export function useWatchedSeries(enabled = true) {
  const { target } = useActiveServer()
  return useQuery({
    queryKey: ['rmab', 'watched-series', target?.serverId],
    queryFn: () =>
      target ? listWatchedSeries(target) : Promise.resolve({ success: false, series: [] }),
    enabled: enabled && Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
}

export function useWatchAuthorMutation() {
  const { target } = useActiveServer()
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['rmab', 'watched-authors'] })
  return {
    add: useMutation({
      mutationFn: (input: Parameters<typeof watchAuthor>[1]) =>
        target ? watchAuthor(target, input) : Promise.resolve({ success: false }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) =>
        target ? unwatchAuthor(target, id) : Promise.resolve({ success: false }),
      onSuccess: invalidate,
    }),
  }
}

export function useWatchSeriesMutation() {
  const { target } = useActiveServer()
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['rmab', 'watched-series'] })
  return {
    add: useMutation({
      mutationFn: (input: Parameters<typeof watchSeries>[1]) =>
        target ? watchSeries(target, input) : Promise.resolve({ success: false }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) =>
        target ? unwatchSeries(target, id) : Promise.resolve({ success: false }),
      onSuccess: invalidate,
    }),
  }
}

export { listRequests }
