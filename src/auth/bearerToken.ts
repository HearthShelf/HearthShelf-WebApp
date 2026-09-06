/**
 * The session token, for cross-origin calls.
 *
 * The auth service sets an HTTP-only session cookie, which the browser sends
 * back to auth.hearthshelf.com automatically. The CONTROL PLANE is a different
 * origin (api.hearthshelf.com), so that cookie never reaches it - the token has
 * to travel as an explicit `Authorization: Bearer`.
 *
 * The auth service's bearer plugin hands the token back in a `set-auth-token`
 * response header on sign-in, and `/api/auth/token` returns it on demand for a
 * session already established (a returning user who never signed in this page
 * load). We cache it in memory and fall back to that endpoint.
 *
 * Deliberately memory-only, not localStorage: this token IS the session, and
 * putting it where any script on the origin can read it turns an XSS into a
 * stolen session that outlives the tab. The cost is one fetch per page load,
 * which is the correct trade.
 */
const AUTH_SERVICE_URL =
  (import.meta.env.VITE_AUTH_SERVICE_URL as string | undefined) ?? 'https://auth.hearthshelf.com'

let cached: string | null = null
let inFlight: Promise<string | null> | null = null

/** Record a token observed on a `set-auth-token` response header. */
export function rememberBearerToken(token: string | null): void {
  cached = token || null
}

/** Forget the cached token (sign-out, or a session the service rejected). */
export function clearBearerToken(): void {
  cached = null
  inFlight = null
}

/**
 * The current session token, or null when signed out.
 *
 * Concurrent callers share one request - the control-plane client asks for a
 * token on every call, and a page that fires several at once should not open
 * several identical fetches.
 */
export async function getBearerToken(): Promise<string | null> {
  if (cached) return cached
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const res = await fetch(`${AUTH_SERVICE_URL.replace(/\/$/, '')}/api/auth/token`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) return null

      // Either shape is fine: the header is set by the bearer plugin, the body
      // by the token endpoint itself.
      const header = res.headers.get('set-auth-token')
      if (header) {
        cached = header
        return cached
      }
      const body = (await res.json().catch(() => null)) as { token?: string } | null
      cached = body?.token || null
      return cached
    } catch {
      return null
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}
