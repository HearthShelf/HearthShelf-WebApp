import { useAuth, useClerk } from '@clerk/clerk-react'
import { useEffect } from 'react'
import { setAuthTokenGetter } from '@/lib/authToken'
import { setSessionExpiredHandler } from '@/api/controlPlane'

/**
 * Bridges Clerk into the control-plane API client:
 *  - feeds the current session token (via the 'hearthshelf' JWT TEMPLATE, which
 *    carries verified email/username the control plane needs) to the API layer;
 *  - registers what to do when the control plane reports the session expired:
 *    sign out and return to /sign-in with a reason, so the user gets a clear
 *    message instead of a silent redirect or a wall of error toasts.
 *
 * Renders nothing.
 */
const JWT_TEMPLATE = 'hearthshelf'

export function ClerkTokenBridge() {
  const { getToken, isLoaded } = useAuth()
  const { signOut } = useClerk()

  useEffect(() => {
    if (!isLoaded) return
    setAuthTokenGetter(() => getToken({ template: JWT_TEMPLATE }))
    setSessionExpiredHandler(() => {
      void signOut({ redirectUrl: '/sign-in?reason=expired' })
    })
  }, [isLoaded, getToken, signOut])

  return null
}
