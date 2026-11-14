/**
 * Client for the auth service's "sign in this device" email flow
 * (auth-service/src/linkSignIn.ts).
 *
 * A plain magic link signs in whichever device opens the email. With this flow
 * the email opens an approval page instead, and the device that ASKED (a car,
 * a TV, a shared computer) polls until someone approves, then finishes the
 * sign-in itself through Better Auth's own verify URL.
 *
 * Every call returns `null` when the service does not have the flow yet (an
 * older deploy answers 404), so the sign-in form can fall back to a plain link.
 */

const AUTH_SERVICE_URL =
  (import.meta.env.VITE_AUTH_SERVICE_URL as string | undefined) ?? 'https://auth.hearthshelf.com'

/** Kept so the approval page can tell it was opened in the browser that asked. */
const PENDING_KEY = 'hs.linkSignIn.pending'

export interface StartedLinkSignIn {
  requestId: string
  pollSecret: string
  matchCode: string
  expiresAt: number
}

export type PollStatus = 'pending' | 'approved' | 'denied' | 'elsewhere' | 'gone'

export interface ApprovalInfo {
  email: string
  matchCode: string
  device?: string
  location?: string
  requestedAt: number
  expiresAt: number
}

export class LinkSignInError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, status: number) {
    super(code)
    this.code = code
    this.status = status
  }
}

/** `action` is a path segment with its slash ('/poll'). */
async function call<T>(action: string, body: object): Promise<T | null> {
  const res = await fetch(`${AUTH_SERVICE_URL}/hs/link-sign-in${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 404 && action === '/start') return null
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new LinkSignInError(data?.error || 'unavailable', res.status)
  return data
}

/**
 * Ask for a sign-in link that signs in THIS browser. Null means the service
 * does not offer the flow, or could not be reached: use a plain magic link.
 */
export async function startLinkSignIn(
  email: string,
  callbackURL: string,
): Promise<StartedLinkSignIn | null> {
  let started: StartedLinkSignIn | null
  try {
    started = await call<StartedLinkSignIn>('/start', { email, callbackURL })
  } catch (e) {
    // A refusal (bad address, too many tries) is the user's to see; a network
    // failure is not a reason to block email sign-in altogether.
    if (e instanceof LinkSignInError) throw e
    return null
  }
  if (started) {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ requestId: started.requestId }))
    } catch {
      // Private mode: the approval page just asks instead of skipping ahead.
    }
  }
  return started
}

export async function pollLinkSignIn(
  requestId: string,
  pollSecret: string,
): Promise<{ status: PollStatus; url?: string }> {
  const res = await call<{ status: PollStatus; url?: string }>('/poll', { requestId, pollSecret })
  return res ?? { status: 'gone' }
}

/** True when this browser started request `requestId`. */
export function startedHere(requestId: string): boolean {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    return Boolean(raw && (JSON.parse(raw) as { requestId?: string }).requestId === requestId)
  } catch {
    return false
  }
}

export function forgetLinkSignIn() {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    // Nothing stored, nothing to forget.
  }
}

const approval =
  <T>(action: string) =>
  async (requestId: string, approveSecret: string): Promise<T> => {
    const res = await call<T>(action, { requestId, approveSecret })
    if (!res) throw new LinkSignInError('not_found', 404)
    return res
  }

export const getApprovalInfo = approval<ApprovalInfo>('/info')
export const approveLinkSignIn = approval<object>('/approve')
export const denyLinkSignIn = approval<object>('/deny')
/** Sign in the browser holding the email instead. Returns the verify URL. */
export const signInHereInstead = approval<{ url: string }>('/here')
