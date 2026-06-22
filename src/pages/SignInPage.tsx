import { SignIn } from '@clerk/clerk-react'
import { Wordmark } from '@/components/Wordmark'

/**
 * Sign-in lives inside app.hs.com (not Clerk's hosted accounts.* pages), so the
 * whole account experience stays on our domain and in our shell. Clerk's
 * embedded <SignIn /> renders the form; routing="path" lets it own /sign-in/*.
 */
export function SignInPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 px-5 py-16">
      <div className="flex items-center gap-2.5">
        <img src="/logo.svg" alt="" className="size-8" />
        <Wordmark className="text-xl" />
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
