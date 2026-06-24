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
  state: string
}

function isConnectMessage(v: unknown): v is ConnectMessage {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { type?: unknown }).type === 'hs-connect-token' &&
    typeof (v as { token?: unknown }).token === 'string' &&
    typeof (v as { state?: unknown }).state === 'string'
  )
}

// Browser-safe random nonce for the state round-trip.
function randomState(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
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
  const state = randomState()
  // Stash which server this attempt is for, so the full-page fallback (popup
  // blocked) can recover the target + verify state after the round-trip.
  try {
    sessionStorage.setItem(
      'hs-connect-pending',
      JSON.stringify({ serverId, serverUrl: origin, state })
    )
  } catch {
    // sessionStorage unavailable (private mode edge) - popup path still works.
  }
  const authCb = `${origin}/hs/hosted/connect-return`
  const authUrl =
    `${origin}/auth/openid` +
    `?auth_cb=${encodeURIComponent(authCb)}` +
    `&state=${encodeURIComponent(state)}`

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
      // Only accept a message from this exact server origin.
      if (e.origin !== origin) return
      if (!isConnectMessage(e.data)) return
      if (e.data.state !== state) return // not our attempt
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
