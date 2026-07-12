import { create } from 'zustand'
import type { AbsTarget } from '@/api/absLibrary'
import { getServerDismissals, addServerDismissal, removeServerDismissal } from '@/api/absDismissals'

// Per-user "not right now" dismissals of series/books from Auto sources (the
// queue + the Continue-* home shelves). Synced from /hs/dismissals; every shelf
// filters against this. Writes are optimistic with rollback, and take the active
// server target (the API is per-server, like absQueue). A `labels` cache (best-
// effort, not synced) lets the Settings restore list show real names.

interface DismissalsState {
  seriesIds: string[]
  itemIds: string[]
  labels: Record<string, string>
  hydrate: (t: AbsTarget) => Promise<void>
  reset: () => void
  dismiss: (
    t: AbsTarget,
    kind: 'series' | 'item',
    entityId: string,
    label?: string,
  ) => Promise<void>
  restore: (t: AbsTarget, kind: 'series' | 'item', entityId: string) => Promise<void>
}

export const useDismissalsStore = create<DismissalsState>((set, get) => ({
  seriesIds: [],
  itemIds: [],
  labels: {},

  hydrate: async (t) => {
    try {
      const d = await getServerDismissals(t)
      set({ seriesIds: d.seriesIds, itemIds: d.itemIds })
    } catch {
      // Server unreachable / not connected yet - keep the cache.
    }
  },

  reset: () => set({ seriesIds: [], itemIds: [], labels: {} }),

  dismiss: async (t, kind, entityId, label) => {
    const key = kind === 'series' ? 'seriesIds' : 'itemIds'
    const prev = { seriesIds: get().seriesIds, itemIds: get().itemIds }
    if (get()[key].includes(entityId)) {
      if (label) set((s) => ({ labels: { ...s.labels, [entityId]: label } }))
      return
    }
    set((s) => ({
      [key]: [...s[key], entityId],
      labels: label ? { ...s.labels, [entityId]: label } : s.labels,
    }))
    try {
      const d = await addServerDismissal(t, kind, entityId)
      set({ seriesIds: d.seriesIds, itemIds: d.itemIds })
    } catch {
      set(prev)
      throw new Error('dismiss_failed')
    }
  },

  restore: async (t, kind, entityId) => {
    const key = kind === 'series' ? 'seriesIds' : 'itemIds'
    const prev = { seriesIds: get().seriesIds, itemIds: get().itemIds }
    if (!get()[key].includes(entityId)) return
    set((s) => ({ [key]: s[key].filter((id) => id !== entityId) }))
    try {
      const d = await removeServerDismissal(t, kind, entityId)
      set({ seriesIds: d.seriesIds, itemIds: d.itemIds })
    } catch {
      set(prev)
      throw new Error('restore_failed')
    }
  },
}))
