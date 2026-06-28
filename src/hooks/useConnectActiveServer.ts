/**
 * Connect to whichever server is currently active.
 *
 * The shell mounts this once. It auto-connects to the active server (a plain
 * grant -> /hs/hosted/connect fetch, no popup) and re-connects whenever the
 * active server changes - so switching servers in the AppBar transparently
 * re-authenticates against the new one. "Selecting a server IS connecting."
 *
 * Connection state lives in the in-memory token store (absTokens); this hook
 * tracks the UI-facing status for the active target.
 */
import { useCallback, useEffect, useState } from 'react'
import { connectServer } from '@/lib/connectServer'
import { hasAbsToken } from '@/lib/absTokens'
import { useActiveServer } from '@/hooks/useActiveServer'

export type ConnectState = 'idle' | 'connecting' | 'connected' | 'error'

export function useConnectActiveServer() {
  const { target } = useActiveServer()
  const serverId = target?.serverId ?? null

  const [state, setState] = useState<ConnectState>('idle')
  const [error, setError] = useState<string | null>(null)

  const connect = useCallback(async () => {
    if (!target) return
    setError(null)
    setState('connecting')
    try {
      await connectServer(target.serverId, target.serverUrl)
      setState('connected')
    } catch (e) {
      setState('error')
      setError(e instanceof Error ? e.message : 'connect_failed')
    }
  }, [target])

  // Re-evaluate whenever the active server changes. If we already hold a token
  // for it (e.g. switched away and back), mark connected without a round-trip;
  // otherwise auto-connect. connectServer dedupes inflight calls, so this is safe.
  useEffect(() => {
    if (!serverId) {
      setState('idle')
      return
    }
    if (hasAbsToken(serverId)) {
      setState('connected')
      return
    }
    void connect()
    // connect is stable per target; serverId drives re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId])

  return {
    state,
    error,
    connect,
    connected: state === 'connected',
    serverId,
  }
}
