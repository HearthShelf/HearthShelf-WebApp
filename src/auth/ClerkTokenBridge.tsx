import { useAuth } from '@clerk/clerk-react'
import { useEffect } from 'react'
import { setAuthTokenGetter } from '@/lib/authToken'

/**
 * Bridges Clerk's session token into the control-plane API client.
 *
 * The control plane (the Worker) verifies the JWT and reads the user's verified
 * email straight out of it - so we request the 'hearthshelf' JWT TEMPLATE, not
 * the default session token. The template (configured in the Clerk dashboard)
 * adds `email` + `email_verified` claims; the default session token does not
 * carry them. This is what lets HS match the ABS user securely by a
 * Clerk-signed email rather than something the browser could spoof.
 *
 * Renders nothing; it just keeps authToken.ts pointed at the live getter.
 */
const JWT_TEMPLATE = 'hearthshelf'

export function ClerkTokenBridge() {
  const { getToken, isLoaded } = useAuth()

  useEffect(() => {
    if (!isLoaded) return
    setAuthTokenGetter(() => getToken({ template: JWT_TEMPLATE }))
  }, [isLoaded, getToken])

  return null
}
