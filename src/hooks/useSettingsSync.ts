import { useCallback, useEffect, useRef } from 'react'
import { useSettingsStore, pendingSettingChanges } from '@/store/settingsStore'
import { useQueueStore } from '@/store/queueStore'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getServerSettings, putServerSettings } from '@/api/absSettings'
import { recomputeServerQueue } from '@/api/absQueue'
import type { AbsTarget } from '@/api/absLibrary'

const PUSH_DEBOUNCE_MS = 1200

function mirrorQueueMode() {
  useQueueStore.getState().setMode(useSettingsStore.getState().queueMode)
}

async function recomputeQueue(target: AbsTarget) {
  try {
    // A plain GET no longer recomputes; a mode/rules change must rebuild now.
    const res = await recomputeServerQueue(target)
    useQueueStore.getState().adoptServer(res.items, res.manual, res.playlistId, res.updatedAt)
  } catch {
    // Server unreachable - keep the current queue cache as-is.
  }
}

// Keeps the local settings store in sync with the active server's copy per-key,
// so a user's settings follow them across devices without one device clobbering
// another's unrelated change. localStorage is the instant cache; this reconciles
// with the server:
//   - when the active server resolves (or changes), pull + merge per-key (LWW)
//   - on any later local change, debounce-push only the keys that changed
//   - after a pull, flush anything the server still doesn't have
//
// What counts as "changed" comes from the store's own pending set (`meta` vs
// `pushed`), not from a snapshot taken here. The snapshot used to be re-based
// after every pull, so an edit still inside the debounce - or one whose push had
// failed while the backend was down - was diffed away and never sent. A key is
// now retired only when the server confirms it, and `pushed` is persisted, so an
// offline edit still pushes after a reload.
//
// Settings are keyed server-side by (server_id, user_id), so switching servers
// re-pulls that server's settings. Account-scoped settings only apply where
// useSharedSettings is on; device-scoped always round-trip (per-device backup).
// Mounted once in AppShell. Best-effort: offline, the app runs from localStorage.
export function useSettingsSync() {
  const { target } = useActiveServer()
  const serverId = target?.serverId ?? null

  const hydrating = useRef(false)
  const hydrated = useRef(false)
  // A push is in flight; its response decides what's still pending.
  const pushing = useRef(false)
  const timer = useRef<number | null>(null)
  // Keep the latest target reachable from the debounced callback without
  // re-creating it (and so re-subscribing) on every render.
  const targetRef = useRef<AbsTarget | null>(target ?? null)
  targetRef.current = target ?? null

  const schedulePush = useCallback(() => {
    if (!hydrated.current || hydrating.current) return
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      // Wait for the in-flight request rather than sending an overlapping batch.
      if (pushing.current) {
        schedulePush()
        return
      }
      const activeTarget = targetRef.current
      if (!activeTarget) return
      const changes = pendingSettingChanges()
      if (!changes.length) return
      const queueSettingsChanged = changes.some(
        (c) => c.key === 'queueMode' || c.key === 'queueAutoRules',
      )
      pushing.current = true
      putServerSettings(activeTarget, useSettingsStore.getState().deviceId, changes)
        .then((res) => {
          // Retire exactly what the server took. Anything unacknowledged stays
          // pending and rides along on the next push.
          const done: Record<string, number> = {}
          for (const c of changes) {
            if (res.applied?.includes(c.key)) done[c.key] = c.updatedAt
          }
          // Invalid values can never be accepted; retire them rather than
          // re-sending them on every future push.
          for (const bad of res.invalid ?? []) {
            const sent = changes.find((c) => c.key === bad.key)
            if (sent) done[bad.key] = sent.updatedAt
          }
          if (Object.keys(done).length) useSettingsStore.getState().markPushed(done)
          // Adopt any value the server rejected as stale (another device newer);
          // applyServerKeys records its updatedAt, which retires the key.
          if (res.rejected?.length) {
            const rows: Record<string, { value: unknown; updatedAt: number }> = {}
            for (const r of res.rejected) rows[r.key] = { value: r.value, updatedAt: r.updatedAt }
            hydrating.current = true
            useSettingsStore.getState().applyServerKeys(rows as never)
            mirrorQueueMode()
            hydrating.current = false
          }
          if (queueSettingsChanged) void recomputeQueue(activeTarget)
        })
        .catch(() => {
          // Best-effort; the change stays pending (and persisted), so the next
          // change or the next pull retries it.
        })
        .finally(() => {
          pushing.current = false
        })
    }, PUSH_DEBOUNCE_MS)
  }, [])

  // Pull when the active server resolves or changes.
  useEffect(() => {
    if (!target) {
      hydrated.current = false
      return
    }
    let cancelled = false
    hydrated.current = false
    const { deviceId } = useSettingsStore.getState()
    getServerSettings(target, deviceId)
      .then((res) => {
        if (cancelled) return
        const useShared = useSettingsStore.getState().useSharedSettings
        hydrating.current = true
        if (useShared && res.account) useSettingsStore.getState().applyServerKeys(res.account)
        if (res.device) useSettingsStore.getState().applyServerKeys(res.device)
        mirrorQueueMode()
        hydrating.current = false
      })
      .catch(() => {
        // Server unreachable / not connected yet - keep localStorage as-is.
      })
      .finally(() => {
        if (cancelled) return
        hydrated.current = true
        // applyServerKeys has retired every key the server acknowledged, so this
        // sends exactly the local edits that never landed.
        schedulePush()
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, schedulePush])

  // Push changed keys back (debounced) once hydrated.
  useEffect(() => {
    if (!target) return
    const unsub = useSettingsStore.subscribe(schedulePush)
    return () => {
      unsub()
      if (timer.current) window.clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, schedulePush])
}
