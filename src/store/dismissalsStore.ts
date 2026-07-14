import { create } from 'zustand'
import type { AbsTarget } from '@/api/absLibrary'
import { getServerDismissals, addServerDismissal, removeServerDismissal } from '@/api/absDismissals'
import { recomputeServerQueue } from '@/api/absQueue'
import { useQueueStore } from '@/store/queueStore'

// Dismissing/restoring hides or re-exposes a series/book across every Auto rule,
// so rebuild the queue now instead of waiting for the play-cooldown / nightly
// job. Best-effort; Auto is server-authoritative so we don't stomp a Manual edit.
async function recomputeAfterDismissChange(t: AbsTarget) {
  if (useQueueStore.getState().mode !== 'auto') return
  try {
    const q = await recomputeServerQueue(t)
    if (useQueueStore.getState().mode === 'manual') return
    useQueueStore.getState().adoptServer(q.items, q.manual, q.playlistId, q.updatedAt)
  } catch {
    // Server unreachable - the nightly job backstops.
  }
}

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
      void recomputeAfterDismissChange(t)
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
      void recomputeAfterDismissChange(t)
    } catch {
      set(prev)
      throw new Error('restore_failed')
    }
  },
}))
