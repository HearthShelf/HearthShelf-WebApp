import { useEffect, useRef } from 'react'
import { validateSetting } from '@hearthshelf/core'
import { useSettingsStore, SYNCED_KEYS, scopeOf } from '@/store/settingsStore'
import { useQueueStore } from '@/store/queueStore'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getServerSettings, putServerSettings, type SettingChange } from '@/api/absSettings'
import { getServerQueue } from '@/api/absQueue'
import type { AbsTarget } from '@/api/absLibrary'

const PUSH_DEBOUNCE_MS = 1200

function mirrorQueueMode() {
  useQueueStore.getState().setMode(useSettingsStore.getState().queueMode)
}

async function pullServerQueue(target: AbsTarget) {
  try {
    const res = await getServerQueue(target)
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
  const lastMeta = useRef<Record<string, number>>({})
  const timer = useRef<number | null>(null)

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
        lastMeta.current = { ...useSettingsStore.getState().meta }
        hydrated.current = true
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId])

  // Push changed keys back (debounced) once hydrated.
  useEffect(() => {
    if (!target) return
    const unsub = useSettingsStore.subscribe(() => {
      if (!hydrated.current || hydrating.current) return
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        const s = useSettingsStore.getState()
        const changes: SettingChange[] = []
        for (const key of SYNCED_KEYS) {
          const k = key as string
          const at = s.meta[k]
          if (at == null) continue
          if (lastMeta.current[k] === at) continue
          const scope = scopeOf(k)
          if (!scope) continue
          const value = (s as unknown as Record<string, unknown>)[k]
          const v = validateSetting(k, value as never)
          if (!v.ok) continue
          changes.push({ scope, key: k, value: v.value, updatedAt: at })
        }
        if (!changes.length) return
        const queueSettingsChanged = changes.some(
          (c) => c.key === 'queueMode' || c.key === 'queueAutoRules',
        )
        putServerSettings(target, s.deviceId, changes)
          .then((res) => {
            if (res.rejected?.length) {
              const rows: Record<string, { value: unknown; updatedAt: number }> = {}
              for (const r of res.rejected) rows[r.key] = { value: r.value, updatedAt: r.updatedAt }
              hydrating.current = true
              useSettingsStore.getState().applyServerKeys(rows as never)
              mirrorQueueMode()
              hydrating.current = false
            }
            lastMeta.current = { ...useSettingsStore.getState().meta }
            if (queueSettingsChanged) void pullServerQueue(target)
          })
          .catch(() => {
            // Best-effort; localStorage already holds the change.
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
