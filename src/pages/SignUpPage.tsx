import { SignInForm } from '@/components/auth/SignInForm'
import { Wordmark } from '@/components/Wordmark'

/**
 * Sign-up, embedded in app.hs.com. Reached from hs.com's "Launch HearthShelf"
 * link and from the sign-in screen. Same on-domain account experience.
 */
export function SignUpPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 px-5 py-16">
      <div className="flex items-center gap-2.5">
        <img src="/flame.png" alt="" className="w-[4em]" />
        <Wordmark style={{ fontSize: '3em' }} />
      </div>
      {/* Same form: every method here creates the account on first use, so
          there is no separate sign-up path to maintain. */}
      <SignInForm />
    </div>
  )
}
