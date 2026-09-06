import { useState } from 'react'
import { authClient } from '@/auth/client'
import { rememberBearerToken } from '@/auth/bearerToken'

/**
 * The sign-in form.
 *
 * Methods, in the order offered:
 *   - passkey  - the one we want people using; no password, no code, no mail
 *   - social   - Google / Apple / Discord, carried over from the old provider
 *   - email    - a magic link, or a 6-digit code if the link is awkward
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
type Step = 'choose' | 'email' | 'magic-sent' | 'otp' | 'two-factor'

const PROVIDERS = [
  { id: 'google', label: 'Continue with Google' },
  { id: 'apple', label: 'Continue with Apple' },
  { id: 'discord', label: 'Continue with Discord' },
] as const

export function SignInForm({ redirectUrl = '/' }: { redirectUrl?: string }) {
  const [step, setStep] = useState<Step>('choose')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    try {
      const res = await fn()
      const failure = res && 'error' in res ? res.error : null
      if (failure) {
        setError(failure.message || `${label} did not complete`)
        return
      }
      if (onDone) onDone()
      else window.location.href = redirectUrl
    } catch (e) {
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

  const onSocial = (provider: string, label: string) => () =>
    run(label, () => authClient.signIn.social({ provider, callbackURL: redirectUrl }))

  function onMagicLink() {
    if (!email.trim()) return setError('Enter your email first')
    return run(
      'Magic link',
      () => authClient.signIn.magicLink({ email: email.trim(), callbackURL: redirectUrl }),
      () => setStep('magic-sent'),
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
          <button className="btn-primary" onClick={onPasskey} disabled={busy}>
            Sign in with a passkey
          </button>
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              className="btn-secondary"
              onClick={onSocial(p.id, `${p.label} sign-in`)}
              disabled={busy}
            >
              {p.label}
            </button>
          ))}
          <button className="btn-secondary" onClick={() => setStep('email')} disabled={busy}>
            Continue with email
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
            className="input"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {errorBanner}
          <button className="btn-primary" onClick={onMagicLink} disabled={busy}>
            Email me a link
          </button>
          <button className="btn-link" onClick={onSendCode} disabled={busy}>
            Prefer a code? Send one
          </button>
          <button className="btn-link" onClick={back('choose')} disabled={busy}>
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
          <button className="btn-secondary" onClick={onSendCode} disabled={busy}>
            Send a code instead
          </button>
          <button className="btn-link" onClick={back('email')} disabled={busy}>
            Use a different email
          </button>
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
            className="input tracking-[0.4em]"
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {errorBanner}
          <button
            className="btn-primary"
            onClick={step === 'otp' ? onVerifyCode : onVerifyTwoFactor}
            disabled={busy}
          >
            {step === 'otp' ? 'Sign in' : 'Verify'}
          </button>
          <button className="btn-link" onClick={back('choose')} disabled={busy}>
            Back to all sign-in options
          </button>
        </>
      )}
    </div>
  )
}
