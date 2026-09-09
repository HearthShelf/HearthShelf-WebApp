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
import { authBreadcrumb, Sentry } from '@/lib/sentry'

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
    authBreadcrumb('server connect start', { serverId: target.serverId })
    try {
      await connectServer(target.serverId, target.serverUrl)
      setState('connected')
      authBreadcrumb('server connect ok', { serverId: target.serverId })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'connect_failed'
      setState('error')
      setError(message)
      // Reported, not just shown: this state replaces EVERY page with one panel,
      // so from the outside it looks like navigation is broken. Without a
      // report the only evidence is a user saying "the URL changes but the
      // page does not", which is what happened.
      Sentry.captureMessage('server connect failed', {
        level: 'warning',
        tags: { auth_flow: 'server_connect' },
        extra: { serverId: target.serverId, serverUrl: target.serverUrl, error: message },
      })
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
