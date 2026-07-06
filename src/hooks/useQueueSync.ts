import { useEffect, useRef } from 'react'
import { useQueueStore } from '@/store/queueStore'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getServerQueue, putServerQueue } from '@/api/absQueue'

const PUSH_DEBOUNCE_MS = 400

// Keeps the local queue store in sync with the active server's copy. The server
// OWNS the queue (Auto mode is computed server-side on GET), so:
//   - when the active server resolves/changes, pull + adopt the server queue
//   - on any later local edit (Manual reorder/remove/add), debounce-push it back
//
// Queued items are keyed server-side by (server_id, user_id), so switching
// servers re-pulls that server's queue. Mounted once in AppShell. Best-effort:
// offline, the app runs from the sessionStorage cache.
export function useQueueSync() {
  const { target } = useActiveServer()
  const serverId = target?.serverId ?? null

  const hydrating = useRef(false)
  const hydrated = useRef(false)
  const lastAt = useRef(0)
  const timer = useRef<number | null>(null)

  // Pull when the active server resolves or changes.
  useEffect(() => {
    if (!target) {
      hydrated.current = false
      return
    }
    let cancelled = false
    hydrated.current = false
    getServerQueue(target)
      .then((res) => {
        if (cancelled) return
        hydrating.current = true
        useQueueStore.getState().adoptServer(res.items, res.playlistId, res.updatedAt)
        hydrating.current = false
      })
      .catch(() => {
        // Server unreachable - keep the sessionStorage cache as-is.
      })
      .finally(() => {
        if (cancelled) return
        lastAt.current = useQueueStore.getState().updatedAt
        hydrated.current = true
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId])

  // Push local edits back (debounced) once hydrated.
  useEffect(() => {
    if (!target) return
    const unsub = useQueueStore.subscribe(() => {
      if (!hydrated.current || hydrating.current) return
      const s = useQueueStore.getState()
      if (s.updatedAt === s.serverUpdatedAt) {
        lastAt.current = s.updatedAt
        return
      }
      if (s.updatedAt === lastAt.current) return // no items/order change
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        const cur = useQueueStore.getState()
        putServerQueue(target, cur.items, cur.playlistId, cur.updatedAt)
          .then((res) => {
            // Adopt the server's state if our write was stale (another device).
            if (!res.applied) {
              hydrating.current = true
              useQueueStore.getState().adoptServer(res.items, res.playlistId, res.updatedAt)
              hydrating.current = false
            }
            lastAt.current = useQueueStore.getState().updatedAt
          })
          .catch(() => {
            // Best-effort; the local store already holds the change.
          })
      }, PUSH_DEBOUNCE_MS)
    })
    return () => {
      unsub()
      if (timer.current) window.clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId])
}
