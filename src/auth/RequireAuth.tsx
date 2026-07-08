import { SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Gate for the whole app. Signed-in users see the children; signed-out users
 * are redirected to /sign-in. Everything except the public /sign-in and
 * /sign-up routes is wrapped in this.
 *
 * The path + query the user was trying to reach (e.g. a /pair?code=... or
 * /account/servers?code=... deep link) is passed through as `redirectUrl`.
 * Clerk appends it to /sign-in as `redirect_url` and honors it over the
 * SignIn/SignUp components' `fallbackRedirectUrl="/"` once signed in.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  const target = `${location.pathname}${location.search}${location.hash}`
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <RedirectToSignIn redirectUrl={target} />
      </SignedOut>
    </>
  )
}
