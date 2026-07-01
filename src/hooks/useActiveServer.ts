/**
 * Resolve the ambient active server against the live linked-server list.
 *
 * This is the single source of truth for "which server am I browsing" across the
 * app. It reconciles the persisted id (useActiveServerStore) with the servers the
 * control plane actually returns:
 *   - no selection yet, or the selected server is gone -> fall back to the first
 *     linked server (covers the common single-server case with zero clicks).
 *   - exactly one server -> always that one.
 *
 * Returns the resolved LinkedServer, its AbsTarget, the full list, loading state,
 * and a setter the server switcher calls.
 */
import { useEffect, useMemo } from 'react'
import { useServers } from '@/hooks/useServers'
import { useActiveServerStore } from '@/store/activeServer'
import type { AbsTarget } from '@/api/absLibrary'
import type { LinkedServer } from '@/types/server'

export interface ActiveServer {
  /** The resolved server, or null while loading / when none are linked. */
  server: LinkedServer | null
  /** ABS target for the resolved server, or null. */
  target: AbsTarget | null
  /** Every server the user can browse, for the switcher. */
  servers: LinkedServer[]
  isLoading: boolean
  /** Select a server by id (server switcher). */
  setActiveServer: (id: string) => void
}

export function useActiveServer(): ActiveServer {
  const { data: servers, isLoading } = useServers()
  const activeServerId = useActiveServerStore((s) => s.activeServerId)
  const setActiveServer = useActiveServerStore((s) => s.setActiveServer)

  // Resolve which server this device browses. Precedence:
  //   1. this device's own explicit pick (persisted activeServerId), if still valid
  //   2. the user's MyHS default server (isDefault), so a fresh device lands there
  //   3. the first linked server (single-server case, zero clicks)
  // A fresh device has no local pick, so it auto-connects to the default; without
  // a default it falls to the first server.
  const resolved = useMemo<LinkedServer | null>(() => {
    if (!servers || servers.length === 0) return null
    const picked = activeServerId ? servers.find((s) => s.id === activeServerId) : undefined
    if (picked) return picked
    const preferred = servers.find((s) => s.isDefault)
    return preferred ?? servers[0]
  }, [servers, activeServerId])

  // Persist the resolution so the store and the live list stay in sync. Runs when
  // we auto-selected (no/stale id) - writing it back means the switcher and the
  // rest of the app read a concrete id, not an implicit "first".
  useEffect(() => {
    if (resolved && resolved.id !== activeServerId) {
      setActiveServer(resolved.id)
    }
  }, [resolved, activeServerId, setActiveServer])

  const target = useMemo<AbsTarget | null>(
    () => (resolved ? { serverId: resolved.id, serverUrl: resolved.url } : null),
    [resolved],
  )

  return {
    server: resolved,
    target,
    servers: servers ?? [],
    isLoading,
    setActiveServer,
  }
}
