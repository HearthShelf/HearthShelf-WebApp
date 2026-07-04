import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { QueueEntry, QueueMode, AutoRuleId } from '@hearthshelf/core'

// Canonical queue types live in @hearthshelf/core; re-exported so existing
// importers keep working and pick up new rules (e.g. book-club) automatically.
export type { QueueEntry, QueueMode, AutoRuleId }

interface QueueStoreState {
  items: QueueEntry[]
  mode: QueueMode
  playlistId: string | null
  // ms epoch of the last local items/playlistId change; the LWW key the server
  // uses (see absQueue.ts). Bumped on hand edits, adopted (not bumped) on pulls.
  updatedAt: number
  add: (entry: QueueEntry) => void
  remove: (libraryItemId: string) => void
  reorder: (from: number, to: number) => void
  clear: () => void
  setItems: (items: QueueEntry[]) => void
  /** Adopt a server-pulled queue WITHOUT bumping updatedAt (so it isn't echoed
   *  straight back as a local write). */
  adoptServer: (items: QueueEntry[], playlistId: string | null, updatedAt: number) => void
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
      mode: 'manual',
      playlistId: null,
      updatedAt: 0,
      add: (entry) =>
        set((s) =>
          s.items.some((i) => i.libraryItemId === entry.libraryItemId)
            ? s
            : { items: [...s.items, entry], updatedAt: Date.now() },
        ),
      remove: (id) =>
        set((s) => ({
          items: s.items.filter((i) => i.libraryItemId !== id),
          updatedAt: Date.now(),
        })),
      reorder: (from, to) =>
        set((s) => {
          const next = s.items.slice()
          const [moved] = next.splice(from, 1)
          next.splice(to, 0, moved)
          return { items: next, updatedAt: Date.now() }
        }),
      clear: () => set({ items: [], updatedAt: Date.now() }),
      setItems: (items) => set({ items, updatedAt: Date.now() }),
      adoptServer: (items, playlistId, updatedAt) => set({ items, playlistId, updatedAt }),
      next: () => {
        const [head, ...rest] = get().items
        if (!head) return null
        set({ items: rest, updatedAt: Date.now() })
        return head
      },
      setMode: (mode) => set({ mode }),
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
