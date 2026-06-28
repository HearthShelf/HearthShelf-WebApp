/**
 * Connect to a server (HS-owned auth - no ABS OIDC, no popup).
 *
 * The browser asks the control plane for a short-lived, server-scoped GRANT
 * (Clerk-session-authed), then POSTs it to that server's own /hs/hosted/connect.
 * The server verifies the grant offline against the pinned control-plane JWKS and
 * returns a per-user ABS token, which we store via absTokens. The SPA then talks
 * STRAIGHT to the server's ABS /api/* with that token.
 *
 * This replaces the old OIDC popup bounce entirely. Because it's a plain fetch
 * (no popup, no user gesture required), it also enables silent/instant connect:
 * a page can call this on load without a click.
 */
import { setAbsToken } from './absTokens'
import { mintGrant } from '@/api/controlPlane'

// Dedupe concurrent connects to the same server (e.g. two components mounting,
// or an auto-connect racing a manual one).
const inflight = new Map<string, Promise<string>>()

/**
 * Connect to one server and resolve with its ABS access token (also stored in
 * absTokens). `serverUrl` is the server's public origin. Throws on a failed grant
 * mint or a server-side connect rejection.
 */
export function connectServer(serverId: string, serverUrl: string): Promise<string> {
  const existing = inflight.get(serverId)
  if (existing) return existing

  const origin = serverUrl.replace(/\/$/, '')
  const promise = (async () => {
    // 1. Mint a grant for THIS server from the control plane (Clerk-authed).
    const { grant } = await mintGrant(serverId)

    // 2. Hand it to the server's own backend, which verifies it offline and
    //    returns a per-user ABS token. Cross-origin POST; the server allows the
    //    app origin via CORS.
    const res = await fetch(`${origin}/hs/hosted/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant }),
    })
    if (!res.ok) {
      let detail = res.statusText
      try {
        const body = (await res.json()) as { error?: string }
        detail = body.error || detail
      } catch {
        // keep statusText
      }
      throw new Error(`connect_failed: ${detail}`)
    }
    const data = (await res.json()) as { token?: string }
    if (!data.token) throw new Error('connect_failed: no_token')

    setAbsToken(serverId, data.token)
    return data.token
  })()

  // Clear the inflight entry whether it resolves or rejects, so a later retry
  // (e.g. after a transient failure) isn't permanently deduped to the failure.
  const tracked = promise.finally(() => {
    if (inflight.get(serverId) === tracked) inflight.delete(serverId)
  })
  inflight.set(serverId, tracked)
  return tracked
}
