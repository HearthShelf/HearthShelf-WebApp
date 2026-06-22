import { SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react'
import type { ReactNode } from 'react'

/**
 * Gate for the whole app. Signed-in users see the children; signed-out users
 * are redirected to /sign-in. Everything except the public /sign-in and
 * /sign-up routes is wrapped in this.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  )
}
