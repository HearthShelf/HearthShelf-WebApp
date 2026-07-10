import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { QueueEntry, QueueMode, AutoRuleId } from '@hearthshelf/core'

// Canonical queue types live in @hearthshelf/core; re-exported so existing
// importers keep working and pick up new rules (e.g. book-club) automatically.
export type { QueueEntry, QueueMode, AutoRuleId }

interface QueueStoreState {
  // The ACTIVE up-next list the player pops from. Rebuilt in Auto/Playlist mode;
  // mirrors `manual` in Manual mode.
  items: QueueEntry[]
  // The DURABLE hand-queued list. add/remove/reorder edit this; it drives Manual
  // mode and, in Auto mode, feeds the 'manual' rule so a hand-picked queue
  // survives every Auto rebuild. Synced via /hs/queue alongside items.
  manual: QueueEntry[]
  mode: QueueMode
  playlistId: string | null
  // ms epoch of the last local items/manual/playlistId change; the LWW key the
  // server uses (see absQueue.ts). Bumped on hand edits, adopted on pulls.
  updatedAt: number
  // Last server timestamp adopted via /hs/queue. Queue sync uses this to avoid
  // echoing a server pull back as a local write when another hook adopts it.
  serverUpdatedAt: number
  add: (entry: QueueEntry) => void
  remove: (libraryItemId: string) => void
  reorder: (from: number, to: number) => void
  /** Replace the durable hand-queued list wholesale. Used when reordering the
   *  hand-added rows inside the merged Auto list (their new relative order is
   *  derived from the merged list and set here). */
  reorderManual: (manual: QueueEntry[]) => void
  clear: () => void
  setItems: (items: QueueEntry[]) => void
  /** Adopt a server-pulled queue WITHOUT bumping updatedAt (so it isn't echoed
   *  straight back as a local write). */
  adoptServer: (
    items: QueueEntry[],
    manual: QueueEntry[],
    playlistId: string | null,
    updatedAt: number,
  ) => void
  next: () => QueueEntry | null
  setMode: (mode: QueueMode) => void
  setPlaylistId: (id: string | null) => void
}

// Client-only up-next queue. ABS has no cross-book session queue, so this lives
// in sessionStorage (clears on tab close). Mode/playlistId ride along so the
// player keeps the user's intent for the session; the durable default mode lives
// in settings (queueMode).
export const useQueueStore = create<QueueStoreState>()(
  persist(
    (set, get) => ({
      items: [],
      manual: [],
      mode: 'manual',
      playlistId: null,
      updatedAt: 0,
      serverUpdatedAt: 0,
      add: (entry) =>
        set((s) => {
          if (s.manual.some((i) => i.libraryItemId === entry.libraryItemId)) return s
          const manual = [...s.manual, entry]
          const items = s.mode === 'manual' ? manual : s.items
          return { manual, items, updatedAt: Date.now() }
        }),
      remove: (id) =>
        set((s) => {
          const manual = s.manual.filter((i) => i.libraryItemId !== id)
          const items = s.mode === 'manual' ? manual : s.items.filter((i) => i.libraryItemId !== id)
          return { manual, items, updatedAt: Date.now() }
        }),
      reorder: (from, to) =>
        set((s) => {
          const manual = s.manual.slice()
          const [moved] = manual.splice(from, 1)
          manual.splice(to, 0, moved)
          const items = s.mode === 'manual' ? manual : s.items
          return { manual, items, updatedAt: Date.now() }
        }),
      reorderManual: (manual) =>
        set((s) => ({
          manual,
          items: s.mode === 'manual' ? manual : s.items,
          updatedAt: Date.now(),
        })),
      clear: () =>
        set((s) => ({
          manual: [],
          items: s.mode === 'manual' ? [] : s.items,
          updatedAt: Date.now(),
        })),
      setItems: (items) => set({ items, updatedAt: Date.now() }),
      adoptServer: (items, manual, playlistId, updatedAt) =>
        set({ items, manual, playlistId, updatedAt, serverUpdatedAt: updatedAt }),
      next: () => {
        const [head, ...rest] = get().items
        if (!head) return null
        set((s) => ({
          items: rest,
          manual: s.mode === 'manual' ? rest : s.manual,
          updatedAt: Date.now(),
        }))
        return head
      },
      setMode: (mode) => set((s) => ({ mode, items: mode === 'manual' ? s.manual : s.items })),
      setPlaylistId: (playlistId) => set({ playlistId }),
    }),
    {
      name: 'hearthshelf:queue',
      storage: {
        getItem: (k) => {
          const v = sessionStorage.getItem(k)
          return v ? JSON.parse(v) : null
        },
        setItem: (k, v) => sessionStorage.setItem(k, JSON.stringify(v)),
        removeItem: (k) => sessionStorage.removeItem(k),
      },
    },
  ),
)
