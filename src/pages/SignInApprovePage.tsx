import { useEffect, useRef, useState } from 'react'
import { Wordmark } from '@/components/Wordmark'
import {
  LinkSignInError,
  approveLinkSignIn,
  denyLinkSignIn,
  forgetLinkSignIn,
  getApprovalInfo,
  signInHereInstead,
  startedHere,
  type ApprovalInfo,
} from '@/auth/linkSignIn'

/**
 * Where an email sign-in link lands (/sign-in/approve#r=<id>&k=<secret>).
 *
 * The link signs in the device that ASKED for it, not this one. So this page
 * says plainly that another device is being signed in, shows the number that
 * device is showing and what it is, and only then offers Approve. Someone who
 * started a request with your address from their own computer is stopped
 * here: their number and their device will not be yours.
 *
 * Opened in the same browser that asked (the usual laptop case), there is
 * nothing to approve: it signs in straight away.
 *
 * The secret is in the fragment, which never reaches a server, and is wiped
 * from the address bar as soon as it is read.
 */
type View =
  | { kind: 'loading' }
  | { kind: 'ask'; info: ApprovalInfo }
  | { kind: 'approved' }
  | { kind: 'denied' }
  | { kind: 'redirecting' }
  | { kind: 'invalid' }
  | { kind: 'error' }

function readLink(): { requestId: string; secret: string } | null {
  const params = new URLSearchParams(window.location.hash.slice(1))
  const requestId = params.get('r')
  const secret = params.get('k')
  return requestId && secret ? { requestId, secret } : null
}

const whenText = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

export function SignInApprovePage() {
  const [initialLink] = useState(readLink)
  const link = useRef(initialLink)
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)

  // Once only: "sign in here" consumes the request, so a second run (React's
  // dev double effect) would find it already used.
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const current = link.current
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname)
    }
    if (!current) {
      setView({ kind: 'invalid' })
      return
    }
    const fail = (e: unknown) =>
      setView({ kind: e instanceof LinkSignInError && e.status < 500 ? 'invalid' : 'error' })
    if (startedHere(current.requestId)) {
      setView({ kind: 'redirecting' })
      signInHereInstead(current.requestId, current.secret)
        .then(({ url }) => {
          forgetLinkSignIn()
          window.location.href = url
        })
        .catch(fail)
    } else {
      getApprovalInfo(current.requestId, current.secret)
        .then((info) => setView({ kind: 'ask', info }))
        .catch(fail)
    }
  }, [])

  async function act(kind: 'approve' | 'deny' | 'here') {
    const current = link.current
    if (!current || busy) return
    setBusy(true)
    try {
      if (kind === 'approve') {
        await approveLinkSignIn(current.requestId, current.secret)
        setView({ kind: 'approved' })
      } else if (kind === 'deny') {
        await denyLinkSignIn(current.requestId, current.secret)
        setView({ kind: 'denied' })
      } else {
        const { url } = await signInHereInstead(current.requestId, current.secret)
        setView({ kind: 'redirecting' })
        window.location.href = url
      }
    } catch (e) {
      setView({ kind: e instanceof LinkSignInError && e.status < 500 ? 'invalid' : 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 px-5 py-16">
      <div className="flex items-center gap-2.5">
        <img src="/flame.png" alt="" className="w-[3em]" />
        <Wordmark style={{ fontSize: '2.25em' }} />
      </div>
      <div className="flex w-full max-w-sm flex-col gap-3">
        {view.kind === 'loading' && (
          <p className="text-sm text-neutral-400">Checking the link...</p>
        )}

        {view.kind === 'redirecting' && (
          <p className="text-sm text-neutral-300">Signing you in...</p>
        )}

        {view.kind === 'ask' && (
          <>
            <h1 className="text-xl font-semibold text-neutral-100">Sign in on another device?</h1>
            <p className="text-sm text-neutral-300">
              Approving signs <strong className="text-neutral-100">{view.info.email}</strong> in on
              the device below, not on this one.
            </p>
            <div className="flex flex-col items-center gap-1 rounded-xl bg-white/5 px-4 py-4">
              <span className="text-xs text-neutral-400">The other screen should show</span>
              <span
                className="font-mono text-4xl font-bold tracking-[0.2em] text-neutral-100"
                aria-label={`Match code ${view.info.matchCode.split('').join(' ')}`}
              >
                {view.info.matchCode}
              </span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-white/5 px-4 py-3 text-sm">
              <dt className="text-neutral-400">Device</dt>
              <dd className="text-right text-neutral-100">{view.info.device || 'Unknown'}</dd>
              {view.info.location && (
                <>
                  <dt className="text-neutral-400">Near</dt>
                  <dd className="text-right text-neutral-100">{view.info.location}</dd>
                </>
              )}
              <dt className="text-neutral-400">Asked at</dt>
              <dd className="text-right text-neutral-100">{whenText(view.info.requestedAt)}</dd>
            </dl>
            <p className="text-xs text-neutral-400">
              Only approve if you are signing in on that device right now and the number matches.
            </p>
            <button
              className="auth-btn auth-btn-primary auth-btn-plain"
              onClick={() => act('approve')}
              disabled={busy}
            >
              Approve
            </button>
            <button
              className="auth-btn auth-btn-provider auth-btn-plain"
              onClick={() => act('deny')}
              disabled={busy}
            >
              Deny
            </button>
            <button className="auth-link" onClick={() => act('here')} disabled={busy}>
              Sign in on this device instead
            </button>
          </>
        )}

        {view.kind === 'approved' && (
          <>
            <h1 className="text-xl font-semibold text-neutral-100">Approved</h1>
            <p className="text-sm text-neutral-300">
              The other device is signing in now. You can close this page.
            </p>
          </>
        )}

        {view.kind === 'denied' && (
          <>
            <h1 className="text-xl font-semibold text-neutral-100">Sign-in stopped</h1>
            <p className="text-sm text-neutral-300">
              Nothing was signed in. If you did not ask for this, your account is safe; someone may
              have typed your email by mistake.
            </p>
          </>
        )}

        {view.kind === 'invalid' && (
          <>
            <h1 className="text-xl font-semibold text-neutral-100">This link no longer works</h1>
            <p className="text-sm text-neutral-300">
              It has expired or was already used. Ask for a new link on the device you want to sign
              in.
            </p>
            <a className="auth-link text-center" href="/sign-in">
              Go to sign-in
            </a>
          </>
        )}

        {view.kind === 'error' && (
          <>
            <h1 className="text-xl font-semibold text-neutral-100">Something went wrong</h1>
            <p className="text-sm text-neutral-300">
              We could not reach HearthShelf. Check your connection and open the link again.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
