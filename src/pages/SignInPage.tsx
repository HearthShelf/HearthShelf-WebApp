import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SignIn } from '@clerk/clerk-react'
import { Wordmark } from '@/components/Wordmark'
import { notify } from '@/lib/notify'

/**
 * Sign-in lives inside app.hs.com (not Clerk's hosted accounts.* pages), so the
 * whole account experience stays on our domain and in our shell. Clerk's
 * embedded <SignIn /> renders the form; routing="path" lets it own /sign-in/*.
 *
 * Query params drive a one-time confirmation toast so arriving here never feels
 * like a dead-end: `signed_out=1` (deliberate sign-out) and `reason=expired`
 * (session expired / forced out).
 */
export function SignInPage() {
  const [params] = useSearchParams()
  const shown = useRef(false)

  useEffect(() => {
    if (shown.current) return
    if (params.get('reason') === 'expired') {
      shown.current = true
      notify.error('Your session expired - please sign in again')
    } else if (params.get('signed_out')) {
      shown.current = true
      notify.success("You've been signed out")
    }
  }, [params])

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 px-5 py-16">
      <div className="flex items-center gap-2.5">
        <img src="/flame.png" alt="" className="w-[4em]" />
        <Wordmark style={{ fontSize: '3em' }} />
      </div>
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/"
      />
    </div>
  )
}
