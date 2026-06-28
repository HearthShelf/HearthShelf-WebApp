/**
 * Connect to a server via the OIDC bounce (design doc section 4.2 / 5).
 *
 * The server's ABS owns the OIDC login; it can only redirect to a same-origin
 * callback, so we send the browser to that server's own /auth/openid in a popup,
 * with auth_cb pointed at the server's /hs/hosted/connect-return relay. That
 * relay postMessages the minted ABS token back to us (pinned to our origin). We
 * resolve with the token, which the caller stores via absTokens.
 *
 * Security: we pin the popup's target to the server origin, verify the
 * message's event.origin equals that server, and match a per-attempt nonce
 * (state) to defeat cross-talk between concurrent connects / forged messages.
 */
import { setAbsToken } from './absTokens'

const POPUP_FEATURES = 'popup=yes,width=520,height=680'
const TIMEOUT_MS = 2 * 60 * 1000

interface ConnectMessage {
  type: 'hs-connect-token'
  token: string
  // ABS's own state, echoed back by the connect-return relay. Informational only
  // now (we don't issue or verify our own nonce on the web flow).
  state?: string
}

function isConnectMessage(v: unknown): v is ConnectMessage {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { type?: unknown }).type === 'hs-connect-token' &&
    typeof (v as { token?: unknown }).token === 'string'
  )
}

// Dedupe concurrent connects to the same server (e.g. two components mounting).
const inflight = new Map<string, Promise<string>>()

/**
 * Drive the OIDC bounce for one server and resolve with its ABS access token
 * (also stored in absTokens). `serverUrl` is the server's public origin. Throws
 * on timeout, popup-blocked, or user-closed-popup.
 */
export function connectServer(serverId: string, serverUrl: string): Promise<string> {
  const existing = inflight.get(serverId)
  if (existing) return existing

  const origin = serverUrl.replace(/\/$/, '')
  // Stash which server this attempt is for, so the full-page fallback (popup
  // blocked) can recover the target after the round-trip.
  try {
    sessionStorage.setItem(
      'hs-connect-pending',
      JSON.stringify({ serverId, serverUrl: origin })
    )
  } catch {
    // sessionStorage unavailable (private mode edge) - popup path still works.
  }
  // ABS web OIDC flow (verified against ABS 2.35.1, Auth.js / OidcAuthStrategy.js):
  // - the callback param is `callback` (ABS reads `redirect_uri || callback`),
  //   NOT `auth_cb`.
  // - We send a RELATIVE callback path, not an absolute URL. ABS's
  //   isValidWebCallbackUrl has a relative-path branch that skips the host
  //   comparison entirely (a leading-slash path can only stay same-origin), which
  //   (a) avoids the host mismatch - nginx makes ABS see the portless stable host
  //   while the browser is on the IP-bearing host:port - and (b) is strictly safer
  //   against open-redirect (no attacker-suppliable host in the callback at all).
  //   ABS then 302s to this path on whatever origin the browser actually loaded.
  // - The web flow REJECTS a caller-supplied `state` ("Invalid state, not allowed
  //   on web flow"), so we do NOT send one. Cross-talk safety rests on origin-
  //   pinning + per-server dedupe instead of a self-issued nonce.
  const authUrl = `${origin}/auth/openid?callback=${encodeURIComponent('/hs/hosted/connect-return')}`

  const promise = new Promise<string>((resolve, reject) => {
    const win = window.open(authUrl, `hs-connect-${serverId}`, POPUP_FEATURES)
    if (!win) {
      reject(new Error('popup_blocked'))
      return
    }
    const popup: Window = win

    let settled = false
    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      clearInterval(closedPoll)
      clearTimeout(timer)
      inflight.delete(serverId)
    }

    function onMessage(e: MessageEvent) {
      // Only accept a message from this exact server origin. (We no longer issue
      // our own state nonce - ABS web flow forbids it - so cross-talk safety
      // rests on this origin pin plus the per-server inflight dedupe above.)
      if (e.origin !== origin) return
      if (!isConnectMessage(e.data)) return
      if (!e.data.token) {
        settled = true
        cleanup()
        reject(new Error('no_token'))
        return
      }
      settled = true
      setAbsToken(serverId, e.data.token)
      cleanup()
      try {
        popup.close()
      } catch {
        // ignore - cross-origin close can throw
      }
      resolve(e.data.token)
    }

    window.addEventListener('message', onMessage)

    // If the user closes the popup before completing, fail fast.
    const closedPoll = window.setInterval(() => {
      if (popup.closed && !settled) {
        cleanup()
        reject(new Error('popup_closed'))
      }
    }, 500)

    const timer = window.setTimeout(() => {
      if (!settled) {
        cleanup()
        try {
          popup.close()
        } catch {
          // ignore
        }
        reject(new Error('connect_timeout'))
      }
    }, TIMEOUT_MS)
  })

  inflight.set(serverId, promise)
  return promise
}
