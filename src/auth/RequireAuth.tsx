import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'

/**
 * Gate for the whole app. Signed-in users see the children; signed-out users
 * are redirected to /sign-in. Everything except the public /sign-in and
 * /sign-up routes is wrapped in this.
 *
 * The path + query the user was trying to reach (e.g. a /pair?code=... or
 * /account/servers?code=... deep link) rides along as `redirect_url`, which the
 * sign-in page honours once the session lands.
 *
 * While the session is still resolving we render NOTHING rather than
 * redirecting. A returning user's session is restored asynchronously, so
 * treating "not yet known" as "signed out" would bounce them to /sign-in on
 * every reload and lose the deep link they arrived with.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { isLoaded, isSignedIn } = useAuth()

  if (!isLoaded) return null

  if (!isSignedIn) {
    const target = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to={`/sign-in?redirect_url=${encodeURIComponent(target)}`} replace />
  }

  return <>{children}</>
}
