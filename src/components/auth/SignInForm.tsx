import { useEffect, useState } from 'react'
import { authClient } from '@/auth/client'
import { rememberBearerToken } from '@/auth/bearerToken'
import {
  LinkSignInError,
  forgetLinkSignIn,
  pollLinkSignIn,
  startLinkSignIn,
  type StartedLinkSignIn,
} from '@/auth/linkSignIn'
import { authBreadcrumb } from '@/lib/sentry'
import {
  AppleIcon,
  DiscordIcon,
  GoogleIcon,
  MailIcon,
  PasskeyIcon,
} from '@/components/auth/ProviderIcons'

/**
 * The sign-in form.
 *
 * Methods, in the order offered:
 *   - passkey  - the one we want people using; no password, no code, no mail
 *   - social   - Google / Apple / Discord, carried over from the old provider
 *   - email    - a link, or a 6-digit code if the link is awkward. The link
 *                signs in THIS browser wherever the email is opened: opening
 *                it shows an approval page, and this screen waits for the
 *                approval (see auth/linkSignIn.ts). An older auth service
 *                without that flow gets a plain magic link instead.
 *   - 2FA      - a TOTP step when the account has it switched on
 *
 * Magic link and email codes both depend on mail delivery, so they fail
 * together; passkeys and social do not. Offering all of them means no single
 * dependency locks anyone out.
 *
 * ACCOUNT CONTINUITY: signing in with the same Google / Apple / Discord account
 * lands on the SAME HearthShelf account as before the identity-provider change,
 * because those identities were seeded against the original account ids.
 */
type Step = 'choose' | 'email' | 'magic-sent' | 'link-wait' | 'otp' | 'two-factor'

/** Where a "sign in this device" request stands, as this screen sees it. */
type LinkState = 'waiting' | 'approved' | 'denied' | 'elsewhere' | 'expired'

const POLL_MS = 2500

function linkErrorMessage(e: LinkSignInError): string {
  if (e.code === 'too_many_requests')
    return 'Too many sign-in links asked for. Wait a few minutes, or use a code.'
  if (e.code === 'invalid_email') return 'That email address does not look right.'
  return 'We could not send a sign-in link. Try again, or use a code.'
}

const PROVIDERS = [
  { id: 'google', label: 'Continue with Google', Icon: GoogleIcon, className: '' },
  { id: 'apple', label: 'Continue with Apple', Icon: AppleIcon, className: ' auth-btn-apple' },
  { id: 'discord', label: 'Continue with Discord', Icon: DiscordIcon, className: '' },
] as const

export function SignInForm({ redirectUrl = '/' }: { redirectUrl?: string }) {
  /**
   * Where a provider should send the browser once it is done.
   *
   * MUST be absolute. A social sign-in leaves this origin entirely, comes back
   * to the AUTH SERVICE's callback, and is redirected from there - so a bare
   * "/" resolves against auth.hearthshelf.com and strands the user on the
   * identity API instead of the app. Same for a magic link, which is opened
   * from a mail client with no page context at all.
   */
  const absoluteReturnUrl = new URL(redirectUrl, window.location.origin).href

  const [step, setStep] = useState<Step>('choose')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<StartedLinkSignIn | null>(null)
  const [linkState, setLinkState] = useState<LinkState>('waiting')

  // Wait for the email to be approved on whatever device opened it, then
  // finish the sign-in HERE through Better Auth's own verify URL. That is what
  // puts the session (and, for "sign in another user", the extra account) in
  // this browser rather than in the one that read the email.
  useEffect(() => {
    if (step !== 'link-wait' || !pending || linkState !== 'waiting') return
    let stopped = false
    let misses = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (stopped) return
      if (Date.now() > pending.expiresAt) return setLinkState('expired')
      try {
        const res = await pollLinkSignIn(pending.requestId, pending.pollSecret)
        if (stopped) return
        if (res.status === 'approved' && res.url) {
          forgetLinkSignIn()
          authBreadcrumb('sign-in accepted', { method: 'Email link (approved)' })
          setLinkState('approved')
          window.location.href = res.url
          return
        }
        if (res.status === 'denied' || res.status === 'elsewhere') {
          forgetLinkSignIn()
          return setLinkState(res.status)
        }
        // "gone" can briefly show while an approval is being recorded, so only
        // a few in a row mean the request has really ended.
        if (res.status === 'gone') {
          misses += 1
          if (misses >= 3) return setLinkState('expired')
        } else misses = 0
      } catch {
        // A dropped poll (a car going under a bridge) is not an answer; try again.
      }
      timer = setTimeout(tick, POLL_MS)
    }
    timer = setTimeout(tick, POLL_MS)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [step, pending, linkState])

  /**
   * Run an auth call and map its outcome onto the form.
   *
   * Better Auth resolves with `{ error }` rather than throwing, so a rejected
   * sign-in is a value to inspect - but a network failure still throws, hence
   * both paths.
   */
  async function run(
    label: string,
    fn: () => Promise<{ error?: { message?: string } | null } | void>,
    onDone?: () => void,
  ) {
    if (busy) return
    setBusy(true)
    setError(null)
    authBreadcrumb('sign-in attempt', { method: label })
    try {
      const res = await fn()
      const failure = res && 'error' in res ? res.error : null
      if (failure) {
        authBreadcrumb('sign-in rejected', { method: label, message: failure.message })
        setError(failure.message || `${label} did not complete`)
        return
      }
      authBreadcrumb('sign-in accepted', { method: label })
      if (onDone) onDone()
      else window.location.href = redirectUrl
    } catch (e) {
      authBreadcrumb('sign-in threw', { method: label, message: (e as Error)?.message })
      setError((e as Error)?.message || `${label} failed`)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Passkey sign-in.
   *
   * Offered unconditionally rather than behind a capability check: the browser
   * prompt is itself the discovery mechanism, and a device holding no passkey
   * for this account reports none - surfaced as a hint to use another method
   * rather than as a failure.
   */
  function onPasskey() {
    return run('Passkey sign-in', async () => {
      const res = await authClient.signIn.passkey()
      if (res?.error) {
        return {
          error: {
            message:
              'No passkey found on this device. Sign in another way, then add a passkey in Settings.',
          },
        }
      }
      // Sign-in returns the bearer token in a header; cache it so the first
      // control-plane call does not need a round trip to fetch one.
      rememberBearerToken(
        (res as { response?: Response })?.response?.headers?.get('set-auth-token') ?? null,
      )
      return res
    })
  }

  // No navigation of our own afterwards - and this is load-bearing. The auth
  // client's own redirect hook sends the browser to the provider the moment
  // the POST returns `{ url, redirect: true }`. If we ALSO set location.href
  // (as the default completion does), ours wins the race: the user lands on
  // "/", the auth gate finds no session, and they are bounced straight back
  // here having never seen Google at all. That was the entire original bug.
  const onSocial = (provider: string, label: string) => () =>
    run(
      label,
      () => authClient.signIn.social({ provider, callbackURL: absoluteReturnUrl }),
      () => {},
    )

  function onMagicLink() {
    if (!email.trim()) return setError('Enter your email first')
    let next: Step = 'magic-sent'
    return run(
      'Magic link',
      async () => {
        try {
          const started = await startLinkSignIn(email.trim(), absoluteReturnUrl)
          if (started) {
            setPending(started)
            setLinkState('waiting')
            next = 'link-wait'
            return
          }
        } catch (e) {
          if (e instanceof LinkSignInError) return { error: { message: linkErrorMessage(e) } }
          throw e
        }
        // The service does not have the approval flow yet: a plain magic link,
        // which signs in whichever device opens it.
        return authClient.signIn.magicLink({ email: email.trim(), callbackURL: absoluteReturnUrl })
      },
      () => setStep(next),
    )
  }

  function onSendCode() {
    if (!email.trim()) return setError('Enter your email first')
    return run(
      'Sending your code',
      () => authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: 'sign-in' }),
      () => setStep('otp'),
    )
  }

  const onVerifyCode = () =>
    run('That code', () => authClient.signIn.emailOtp({ email: email.trim(), otp: code.trim() }))

  const onVerifyTwoFactor = () =>
    run('That code', () => authClient.twoFactor.verifyTotp({ code: code.trim() }))

  const back = (to: Step) => () => {
    setStep(to)
    setCode('')
    setError(null)
  }

  const errorBanner = error ? (
    <p className="rounded-md bg-red-500/15 px-3 py-2 text-sm text-red-300" role="alert">
      {error}
    </p>
  ) : null

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      {step === 'choose' && (
        <>
          <button className="auth-btn auth-btn-primary" onClick={onPasskey} disabled={busy}>
            <PasskeyIcon />
            <span>Sign in with a passkey</span>
          </button>
          <div className="auth-divider">or continue with</div>
          <div className="auth-provider-grid">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                className={`auth-btn auth-btn-provider auth-btn-icon${p.className}`}
                onClick={onSocial(p.id, `${p.label} sign-in`)}
                disabled={busy}
                aria-label={p.label}
                title={p.label}
              >
                <p.Icon />
              </button>
            ))}
          </div>
          <button
            className="auth-link auth-email-link"
            onClick={() => setStep('email')}
            disabled={busy}
          >
            <MailIcon />
            <span>Use email instead</span>
          </button>
          {errorBanner}
        </>
      )}

      {step === 'email' && (
        <>
          <label className="text-sm text-neutral-400" htmlFor="signin-email">
            No password needed - we will send you a link, or a code if you prefer.
          </label>
          <input
            id="signin-email"
            className="auth-input"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {errorBanner}
          <button
            className="auth-btn auth-btn-primary auth-btn-plain"
            onClick={onMagicLink}
            disabled={busy}
          >
            Email me a link
          </button>
          <button className="auth-link" onClick={onSendCode} disabled={busy}>
            Prefer a code? Send one
          </button>
          <button className="auth-link" onClick={back('choose')} disabled={busy}>
            Back to all sign-in options
          </button>
        </>
      )}

      {step === 'magic-sent' && (
        <>
          <p className="text-sm text-neutral-300">
            We sent a sign-in link to {email}. Open it in this browser and you are in.
          </p>
          {errorBanner}
          <button
            className="auth-btn auth-btn-provider auth-btn-plain"
            onClick={onSendCode}
            disabled={busy}
          >
            Send a code instead
          </button>
          <button className="auth-link" onClick={back('email')} disabled={busy}>
            Use a different email
          </button>
        </>
      )}

      {step === 'link-wait' && pending && (
        <>
          {linkState === 'waiting' && (
            <>
              <p className="text-sm text-neutral-300">
                We sent a link to {email}. Open it on any device, like your phone, and tap Approve.
                This screen signs in by itself.
              </p>
              <div className="flex flex-col items-center gap-1 rounded-xl bg-white/5 px-4 py-4">
                <span className="text-xs text-neutral-400">Check that this number matches</span>
                <span
                  className="font-mono text-4xl font-bold tracking-[0.2em] text-neutral-100"
                  aria-label={`Match code ${pending.matchCode.split('').join(' ')}`}
                >
                  {pending.matchCode}
                </span>
              </div>
              <p className="text-xs text-neutral-500" aria-live="polite">
                Waiting for approval...
              </p>
            </>
          )}
          {linkState === 'approved' && (
            <p className="text-sm text-neutral-300" aria-live="polite">
              Approved. Signing you in...
            </p>
          )}
          {linkState === 'denied' && (
            <p className="rounded-md bg-red-500/15 px-3 py-2 text-sm text-red-300" role="alert">
              That sign-in was declined on the other device.
            </p>
          )}
          {linkState === 'elsewhere' && (
            <>
              <p className="text-sm text-neutral-300" role="status">
                That link was used to sign in on the device that opened it, not this one.
              </p>
              <button
                className="auth-link"
                onClick={() => (window.location.href = redirectUrl)}
                disabled={busy}
              >
                Signed in here in another tab? Continue
              </button>
            </>
          )}
          {linkState === 'expired' && (
            <p className="rounded-md bg-red-500/15 px-3 py-2 text-sm text-red-300" role="alert">
              That link expired. Send another one to try again.
            </p>
          )}
          {errorBanner}
          {linkState !== 'waiting' && linkState !== 'approved' && (
            <button
              className="auth-btn auth-btn-primary auth-btn-plain"
              onClick={onMagicLink}
              disabled={busy}
            >
              Send another link
            </button>
          )}
          {linkState !== 'approved' && (
            <>
              <button
                className="auth-btn auth-btn-provider auth-btn-plain"
                onClick={onSendCode}
                disabled={busy}
              >
                Use a code instead
              </button>
              <button className="auth-link" onClick={back('email')} disabled={busy}>
                Use a different email
              </button>
            </>
          )}
        </>
      )}

      {(step === 'otp' || step === 'two-factor') && (
        <>
          <label className="text-sm text-neutral-400" htmlFor="signin-code">
            {step === 'otp'
              ? `We sent a 6-digit code to ${email}.`
              : 'Open your authenticator app and enter the 6-digit code.'}
          </label>
          <input
            id="signin-code"
            className="auth-input tracking-[0.4em]"
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {errorBanner}
          <button
            className="auth-btn auth-btn-primary auth-btn-plain"
            onClick={step === 'otp' ? onVerifyCode : onVerifyTwoFactor}
            disabled={busy}
          >
            {step === 'otp' ? 'Sign in' : 'Verify'}
          </button>
          <button className="auth-link" onClick={back('choose')} disabled={busy}>
            Back to all sign-in options
          </button>
        </>
      )}

      {/* Every method on this form CREATES the account on first use - there is
          no separate sign-up path - so this is the only place the terms can be
          disclosed before someone is signed up. The phone app has said so all
          along; the web never did. */}
      <p className="auth-terms">
        By continuing you agree to the{' '}
        <a href="https://hearthshelf.com/terms" target="_blank" rel="noopener noreferrer">
          Terms
        </a>{' '}
        &amp;{' '}
        <a href="https://hearthshelf.com/privacy" target="_blank" rel="noopener noreferrer">
          Privacy Policy
        </a>
        .
      </p>
    </div>
  )
}
