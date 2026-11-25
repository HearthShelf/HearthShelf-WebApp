/**
 * Duplicate library items, per server: one folder AudiobookShelf recorded twice
 * (see @hearthshelf/core lib/duplicates.ts for how that happens and the rules).
 *
 * This is the app-side memory of "item X is really item Y". It learns from two
 * places: the issues probe (useDuplicateWatch) and any list that carries item
 * paths (full library items, home shelves, search, series), so a pair seen on
 * one page is hidden on every page. Fetchers call dedupeForServer() on what they
 * return; navigation calls resolveForServer() before opening an item.
 *
 * Plain zustand (not persisted): the index is rebuilt each session from the
 * server, so a cleaned-up duplicate is forgotten on the next load.
 */
import { create } from 'zustand'
import {
  buildDuplicateIndex,
  findDuplicateItems,
  hideDuplicateItems,
  resolveKeeperId,
  type DuplicateCandidate,
  type DuplicateIndex,
} from '@hearthshelf/core'

interface DuplicatesStore {
  byServer: Record<string, DuplicateIndex>
}

const EMPTY: DuplicateIndex = {}

export const useDuplicatesStore = create<DuplicatesStore>(() => ({ byServer: {} }))

/** The known duplicate -> keeper map for a server. */
export function duplicateIndexFor(serverId: string): DuplicateIndex {
  return useDuplicatesStore.getState().byServer[serverId] ?? EMPTY
}

/** React read of the same map; re-renders only when it changes. */
export function useDuplicateIndex(serverId: string | undefined): DuplicateIndex {
  return useDuplicatesStore((s) => (serverId ? (s.byServer[serverId] ?? EMPTY) : EMPTY))
}

/**
 * Add pairs to a server's map. Keeps the same object when nothing is new, so
 * subscribers (and the list invalidation in useDuplicateWatch) don't churn.
 */
export function learnDuplicates(serverId: string, index: DuplicateIndex): boolean {
  const current = duplicateIndexFor(serverId)
  let next: Record<string, string> | null = null
  for (const [dup, keeper] of Object.entries(index)) {
    if (dup === keeper || current[dup] === keeper) continue
    next ??= { ...current }
    next[dup] = keeper
  }
  if (!next) return false
  const merged = next
  useDuplicatesStore.setState((s) => ({ byServer: { ...s.byServer, [serverId]: merged } }))
  return true
}

function isCandidate<T extends { id: string }>(item: T): item is T & DuplicateCandidate {
  const c = item as Partial<DuplicateCandidate>
  return (
    typeof c.libraryId === 'string' && c.libraryId !== '' && (Boolean(c.path) || Boolean(c.ino))
  )
}

/**
 * Hide duplicate tiles from a fetched list. Items that carry path/ino also
 * teach the server's map, so the pair is hidden elsewhere too.
 */
export function dedupeForServer<T extends { id: string }>(serverId: string, items: T[]): T[] {
  const candidates = items.filter((item): item is T & DuplicateCandidate => isCandidate(item))
  if (candidates.length > 1)
    learnDuplicates(serverId, buildDuplicateIndex(findDuplicateItems(candidates)))
  return hideDuplicateItems(items, duplicateIndexFor(serverId))
}

/** The id to open for `itemId`: its keeper when it is a known duplicate. */
export function resolveForServer(serverId: string, itemId: string): string {
  return resolveKeeperId(duplicateIndexFor(serverId), itemId)
}
