/**
 * Provides "who else finished this book" for a set of library items, so cards in
 * a grid can show reader-avatar stacks without a request per tile.
 *
 * The provider is handed the item IDs it should cover (the grid already has the
 * full list). It batch-fetches finished-by for them in one query (chunked to the
 * server's 100-id cap inside getFinishedByBulk), excludes the signed-in user from
 * every list (this is "who ELSE read it"), and exposes a per-item lookup via
 * useReadersOf(). Everything degrades to empty on older servers / no data, so the
 * avatars simply don't render.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getMe } from '@/api/absLibrary'
import { getFinishedByBulk, socialKeys } from '@/api/absSocial'
import type { AbsTarget } from '@/api/absLibrary'
import type { HSFinishedByUser } from '@hearthshelf/core'

interface ReadersContextValue {
  target: AbsTarget | null
  byItem: Record<string, HSFinishedByUser[]>
}

const EMPTY_READERS: HSFinishedByUser[] = []
const ReadersContext = createContext<ReadersContextValue>({ target: null, byItem: {} })

interface ReadersProviderProps {
  /** The library item IDs whose readers this grid needs. Order-insensitive. */
  itemIds: string[]
  children: ReactNode
}

export function ReadersProvider({ itemIds, children }: ReadersProviderProps) {
  const { target } = useActiveServer()
  const serverId = target?.serverId ?? ''

  // Exclude self: the bulk endpoint always includes the caller (they "share"
  // with themselves), but these cards show who ELSE read the book.
  const { data: me } = useQuery({
    queryKey: ['abs-me', serverId],
    queryFn: () => getMe(target!),
    enabled: Boolean(target),
    staleTime: 10 * 60 * 1000,
  })
  const meId = me?.id ?? ''

  // Stabilise the id set so the query key doesn't churn on every render / reorder.
  const ids = useMemo(() => [...new Set(itemIds.filter(Boolean))].sort(), [itemIds])

  const { data } = useQuery({
    queryKey: socialKeys.finishedByBulk(serverId, ids),
    queryFn: () => getFinishedByBulk(target!, ids),
    enabled: Boolean(target && ids.length),
    staleTime: 5 * 60 * 1000,
  })

  const value = useMemo<ReadersContextValue>(() => {
    if (!data?.available) return { target, byItem: {} }
    const byItem: Record<string, HSFinishedByUser[]> = {}
    for (const [id, users] of Object.entries(data.byItem)) {
      const others = meId ? users.filter((u) => u.userId !== meId) : users
      if (others.length) byItem[id] = others
    }
    return { target, byItem }
  }, [data, meId, target])

  return <ReadersContext.Provider value={value}>{children}</ReadersContext.Provider>
}

/** The other users who finished a given item (empty when none / unavailable). */
export function useReadersOf(itemId: string): HSFinishedByUser[] {
  const { byItem } = useContext(ReadersContext)
  return byItem[itemId] ?? EMPTY_READERS
}

/**
 * The distinct other users who finished ANY of the given items (for a series
 * card that aggregates across its books). Deduped by userId, keeping the most
 * recent finish. Empty when none / unavailable.
 */
export function useReadersOfItems(itemIds: string[]): HSFinishedByUser[] {
  const { byItem } = useContext(ReadersContext)
  return useMemo(() => {
    const best = new Map<string, HSFinishedByUser>()
    for (const id of itemIds) {
      for (const u of byItem[id] ?? EMPTY_READERS) {
        const prev = best.get(u.userId)
        if (!prev || (u.finishedAt ?? 0) > (prev.finishedAt ?? 0)) best.set(u.userId, u)
      }
    }
    return [...best.values()].sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
  }, [byItem, itemIds])
}

/** The active server target, for sourcing avatar photos in a stack. */
export function useReadersTarget(): AbsTarget | null {
  return useContext(ReadersContext).target
}
