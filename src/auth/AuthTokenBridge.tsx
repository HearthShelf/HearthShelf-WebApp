import { useEffect } from 'react'
import { useAuth } from './useAuth'
import { clearBearerToken, getBearerToken } from './bearerToken'
import { authBreadcrumb, reportSessionExpired } from '@/lib/sentry'
import { setAuthTokenGetter } from '@/lib/authToken'
import { setSessionExpiredHandler } from '@/api/controlPlane'

/**
 * Bridges the auth client into the control-plane API client:
 *  - feeds the current session token to the API layer;
 *  - registers what to do when the control plane reports the session expired:
 *    sign out and return to /sign-in with a reason, so the user gets a clear
 *    message instead of a silent redirect or a wall of error toasts.
 *
 * The session cookie only reaches the auth service's own origin, so the control
 * plane - a different origin - needs the token sent explicitly as a bearer. See
 * ./bearerToken.ts for how it is obtained and why it is memory-only.
 *
 * Renders nothing.
 */
export function AuthTokenBridge() {
  const { isLoaded, signOut } = useAuth()

  useEffect(() => {
    if (!isLoaded) return
    setAuthTokenGetter(() => getBearerToken())
    setSessionExpiredHandler(() => {
      // Reported, not silent: this is the single symptom every auth
      // misconfiguration produces, so its rate is the outage signal.
      reportSessionExpired(window.location.pathname)
      clearBearerToken()
      void signOut({ redirectUrl: '/sign-in?reason=expired' })
    })
    authBreadcrumb('auth bridge ready')
  }, [isLoaded, signOut])

  return null
}
