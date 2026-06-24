/**
 * Connect + browse hooks for a single server's ABS library.
 *
 * useConnect drives the OIDC bounce (or no-ops if we already hold a token).
 * useLibraries / useLibraryItems read through the direct ABS client, enabled
 * only once connected so they never fire an unauthenticated request that would
 * pop the login flow at an unexpected moment.
 */
import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { connectServer } from '@/lib/connectServer'
import { hasAbsToken } from '@/lib/absTokens'
import {
  getLibraries,
  getLibraryItems,
  searchLibrary,
  getPersonalizedShelves,
  type AbsTarget,
  type LibraryItemsPage,
  type AbsLibrary,
  type AbsListItem,
  type Shelf,
} from '@/api/absLibrary'

export type ConnectState = 'idle' | 'connecting' | 'connected' | 'error'

/**
 * Manage the connection to one server. Exposes a `connect()` the UI calls (from
 * a user gesture, so the popup isn't blocked) and the current state. Connection
 * lives in the in-memory token store; this hook tracks the UI-facing status.
 */
export function useConnect(target: AbsTarget) {
  const [state, setState] = useState<ConnectState>(
    hasAbsToken(target.serverId) ? 'connected' : 'idle'
  )
  const [error, setError] = useState<string | null>(null)

  const connect = useCallback(async () => {
    setError(null)
    setState('connecting')
    try {
      await connectServer(target.serverId, target.serverUrl)
      setState('connected')
    } catch (e) {
      setState('error')
      setError(e instanceof Error ? e.message : 'connect_failed')
    }
  }, [target.serverId, target.serverUrl])

  return { state, error, connect, connected: state === 'connected' }
}

export function useShelves(target: AbsTarget, libraryId: string | undefined, enabled: boolean) {
  return useQuery<Shelf[]>({
    queryKey: ['abs-shelves', target.serverId, libraryId],
    queryFn: () => getPersonalizedShelves(target, libraryId as string),
    enabled: enabled && Boolean(libraryId),
    staleTime: 60 * 1000,
  })
}

export function useLibraries(target: AbsTarget, enabled: boolean) {
  return useQuery<AbsLibrary[]>({
    queryKey: ['abs-libraries', target.serverId],
    queryFn: () => getLibraries(target),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

export function useLibraryItems(
  target: AbsTarget,
  libraryId: string | undefined,
  page: number,
  enabled: boolean
) {
  return useQuery<LibraryItemsPage>({
    queryKey: ['abs-items', target.serverId, libraryId, page],
    queryFn: () => getLibraryItems(target, libraryId as string, { page }),
    enabled: enabled && Boolean(libraryId),
    staleTime: 60 * 1000,
  })
}

/** Debounce a fast-changing value (search box) by `delayMs`. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

export function useLibrarySearch(
  target: AbsTarget,
  libraryId: string | undefined,
  query: string,
  enabled: boolean
) {
  const q = query.trim()
  return useQuery<AbsListItem[]>({
    queryKey: ['abs-search', target.serverId, libraryId, q],
    queryFn: () => searchLibrary(target, libraryId as string, q),
    enabled: enabled && Boolean(libraryId) && q.length > 0,
    staleTime: 30 * 1000,
  })
}
