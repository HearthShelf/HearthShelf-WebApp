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
 *
 * THE STATE IS SHARED, not per-component, and that is load-bearing. Four
 * separate components call this hook (AppShell, ActiveServerMediaUI,
 * useActiveLibrary, useMediaProgress). With per-instance `useState` each got
 * its own copy: AppShell would start the connect, and ActiveServerMediaUI's
 * instance - mounting a moment later, while that request was still in flight -
 * saw neither a stored token yet nor a result of its own. `connectServer`
 * dedupes the network call, so whichever instance lost the race could sit at
 * 'connecting' indefinitely.
 *
 * Because ActiveServerMediaUI wraps EVERY route, a stuck instance replaces the
 * whole page with "Connecting to..." while the URL keeps changing underneath -
 * which reads exactly like broken navigation, with no error anywhere to explain
 * it. One module-level store, one subscription, one truth.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { connectServer } from '@/lib/connectServer'
import { hasAbsToken } from '@/lib/absTokens'
import { useActiveServer } from '@/hooks/useActiveServer'
import { authBreadcrumb, Sentry } from '@/lib/sentry'

export type ConnectState = 'idle' | 'connecting' | 'connected' | 'error'

interface ConnectSnapshot {
  serverId: string | null
  state: ConnectState
  error: string | null
}

let snapshot: ConnectSnapshot = { serverId: null, state: 'idle', error: null }
const listeners = new Set<() => void>()

function publish(next: ConnectSnapshot): void {
  // Reference equality is the store contract: only allocate a new snapshot when
  // something actually changed, or useSyncExternalStore re-renders forever.
  if (
    next.serverId === snapshot.serverId &&
    next.state === snapshot.state &&
    next.error === snapshot.error
  ) {
    return
  }
  snapshot = next
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function getSnapshot(): ConnectSnapshot {
  return snapshot
}

export function useConnectActiveServer() {
  const { target } = useActiveServer()
  const serverId = target?.serverId ?? null
  const shared = useSyncExternalStore(subscribe, getSnapshot)

  const connect = useCallback(async () => {
    if (!target) return
    publish({ serverId: target.serverId, state: 'connecting', error: null })
    authBreadcrumb('server connect start', { serverId: target.serverId })
    try {
      await connectServer(target.serverId, target.serverUrl)
      publish({ serverId: target.serverId, state: 'connected', error: null })
      authBreadcrumb('server connect ok', { serverId: target.serverId })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'connect_failed'
      publish({ serverId: target.serverId, state: 'error', error: message })
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
  // otherwise auto-connect. Several mounted callers race here; connectServer
  // dedupes the request and the guard below dedupes the attempt.
  useEffect(() => {
    if (!serverId) {
      publish({ serverId: null, state: 'idle', error: null })
      return
    }
    if (hasAbsToken(serverId)) {
      publish({ serverId, state: 'connected', error: null })
      return
    }
    // Another instance is already connecting to this same server; let it finish
    // rather than starting a second attempt whose result we would double-report.
    if (snapshot.serverId === serverId && snapshot.state === 'connecting') return
    void connect()
    // connect is stable per target; serverId drives re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId])

  // A snapshot for a DIFFERENT server is stale (the active server just changed
  // and the effect has not run yet), so report 'connecting' rather than leaking
  // the previous server's state - including a stale 'connected', which would
  // hand callers a target they hold no token for.
  const forThisServer = shared.serverId === serverId
  const state: ConnectState = !serverId ? 'idle' : forThisServer ? shared.state : 'connecting'

  return {
    state,
    error: forThisServer ? shared.error : null,
    connect,
    connected: state === 'connected',
    serverId,
  }
}
