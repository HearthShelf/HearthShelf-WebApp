/**
 * The session token, for cross-origin calls.
 *
 * The auth service sets an HTTP-only session cookie, which the browser sends
 * back to auth.hearthshelf.com automatically. The CONTROL PLANE is a different
 * origin (api.hearthshelf.com), so that cookie never reaches it - the token has
 * to travel as an explicit `Authorization: Bearer`.
 *
 * The auth service's bearer plugin stamps a `set-auth-token` response header on
 * any authenticated response, so `/api/auth/get-session` doubles as the way to
 * obtain one for a session already established (a returning user who never
 * signed in this page load). We cache it in memory.
 *
 * NOT `/api/auth/token` - that belongs to the `jwt` plugin, which this service
 * does not run, and it returns a signed JWT rather than the session token the
 * control plane resolves. Pointing here at an unregistered endpoint 404s, every
 * control-plane call then 401s, and the app treats that as an expired session
 * and bounces the user to sign-in - a successful sign-in looking like a failure.
 *
 * Deliberately memory-only, not localStorage: this token IS the session, and
 * putting it where any script on the origin can read it turns an XSS into a
 * stolen session that outlives the tab. The cost is one fetch per page load,
 * which is the correct trade.
 */
import { authBreadcrumb } from '@/lib/sentry'

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
      const res = await fetch(`${AUTH_SERVICE_URL.replace(/\/$/, '')}/api/auth/get-session`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) {
        authBreadcrumb('token fetch failed', { status: res.status })
        return null
      }

      // The bearer plugin stamps the token on the response of any authenticated
      // request. A signed-out visitor gets a 200 with a null body and no
      // header, which correctly yields null rather than an error.
      cached = res.headers.get('set-auth-token')
      // A 200 with no header means either "signed out" (fine) or "the header is
      // not exposed to us cross-origin" (a misconfiguration that silently
      // breaks every authenticated call) - worth being able to tell apart.
      if (!cached) authBreadcrumb('token fetch returned no set-auth-token header')
      return cached
    } catch (e) {
      authBreadcrumb('token fetch threw', { message: (e as Error)?.message })
      return null
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}
