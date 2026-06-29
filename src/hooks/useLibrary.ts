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
  getAuthor,
  getCollections,
  getCollection,
  type AbsTarget,
  type LibraryItemsPage,
  type AbsLibrary,
  type AbsListItem,
  type AbsLibraryItem,
  type Shelf,
  type AuthorDetail,
  type CollectionSummary,
  type CollectionDetail,
} from '@/api/absLibrary'
import {
  getItemsInProgress,
  getHomeShelves,
  searchLibraryFull,
  type HomeShelf,
  type LibrarySearchResults,
} from '@/api/absHome'

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

  // Auto-connect on mount when we don't already hold a token. Connect is now a
  // plain fetch (grant -> /hs/hosted/connect, no popup/gesture), so landing on a
  // server view silently connects - "selecting a server IS connecting". The
  // connect itself is deduped (connectServer inflight map), so this is safe even
  // if it races another caller. setState happens in the async callback, not the
  // effect body, so the set-state-in-effect lint rule is satisfied.
  useEffect(() => {
    if (state === 'idle') void connect()
    // Only on mount / when the target changes; connect is stable per target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.serverId])

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

/**
 * Personalized home shelves (book + series), keeping ABS's shelf type so the
 * home page renders book and series shelves distinctly.
 */
export function useHomeShelves(
  target: AbsTarget,
  libraryId: string | undefined,
  enabled: boolean
) {
  return useQuery<HomeShelf[]>({
    queryKey: ['abs-home-shelves', target.serverId, libraryId],
    queryFn: () => getHomeShelves(target, libraryId as string),
    enabled: enabled && Boolean(libraryId),
    staleTime: 60 * 1000,
  })
}

/** The user's in-progress books on the active server (home "continue listening"). */
export function useItemsInProgress(
  target: AbsTarget,
  libraryId: string | undefined,
  enabled: boolean
) {
  return useQuery<AbsLibraryItem[]>({
    queryKey: ['abs-items-in-progress', target.serverId, libraryId],
    queryFn: () => getItemsInProgress(target, libraryId),
    enabled,
    staleTime: 30 * 1000,
  })
}

export function useAuthor(target: AbsTarget, authorId: string | undefined, enabled: boolean) {
  return useQuery<AuthorDetail>({
    queryKey: ['abs-author', target.serverId, authorId],
    queryFn: () => getAuthor(target, authorId as string),
    enabled: enabled && Boolean(authorId),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCollections(target: AbsTarget, libraryId: string | undefined, enabled: boolean) {
  return useQuery<CollectionSummary[]>({
    queryKey: ['abs-collections', target.serverId, libraryId],
    queryFn: () => getCollections(target, libraryId as string),
    enabled: enabled && Boolean(libraryId),
    staleTime: 60 * 1000,
  })
}

export function useCollection(target: AbsTarget, collectionId: string | undefined, enabled: boolean) {
  return useQuery<CollectionDetail>({
    queryKey: ['abs-collection', target.serverId, collectionId],
    queryFn: () => getCollection(target, collectionId as string),
    enabled: enabled && Boolean(collectionId),
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

/**
 * Multi-section search (books + series + authors + narrators) for the Search
 * page, from one ABS /search call.
 */
export function useLibrarySearchFull(
  target: AbsTarget,
  libraryId: string | undefined,
  query: string,
  enabled: boolean
) {
  const q = query.trim()
  return useQuery<LibrarySearchResults>({
    queryKey: ['abs-search-full', target.serverId, libraryId, q],
    queryFn: () => searchLibraryFull(target, libraryId as string, q),
    enabled: enabled && Boolean(libraryId) && q.length > 0,
    staleTime: 30 * 1000,
  })
}
