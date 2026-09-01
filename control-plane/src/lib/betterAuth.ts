/**
 * Better Auth session verification.
 *
 * Better Auth issues opaque session tokens rather than self-contained JWTs, so
 * unlike the Clerk path there is nothing to verify offline against a JWKS - we
 * ask the auth service to resolve the session. That is a network hop on the
 * authenticated path, so results are cached briefly in-isolate (see
 * SESSION_CACHE_TTL_MS); Workers reuse isolates, so a burst of requests from
 * one client costs one round-trip rather than one per request.
 *
 * The cache is deliberately SHORT. A revoked session should stop working
 * quickly, and the grants this feeds are themselves short-lived
 * (GRANT_TTL_SECONDS, 300s by default), so a stale hit cannot outlive the
 * blast radius of a grant that was already minted a moment earlier.
 *
 * `subject` is Better Auth's user id. For accounts carried over from Clerk
 * that id IS the original Clerk user id - the migration seeds it verbatim so
 * per-user rows on every box keep resolving. See LegacyAccountSeed in
 * @hearthshelf/core.
 */
import { AuthError } from './clerk'
import type { AuthIdentity } from './identity'
import type { Env } from '../types'

/** How long a resolved session may be reused within an isolate. */
const SESSION_CACHE_TTL_MS = 10_000

/** Give up on the auth service rather than hanging the request. */
const SESSION_FETCH_TIMEOUT_MS = 5_000

interface CachedSession {
  identity: AuthIdentity
  expiresAt: number
}

const sessionCache = new Map<string, CachedSession>()

/** Shape Better Auth returns from GET /api/auth/get-session. */
interface BetterAuthSession {
  user?: {
    id?: unknown
    email?: unknown
    emailVerified?: unknown
    username?: unknown
    name?: unknown
  }
}

/**
 * Resolve a Better Auth session token into an identity.
 *
 * Throws AuthError when the service is unconfigured, unreachable, or rejects
 * the token, and when the resolved account has no VERIFIED email - boxes match
 * an ABS user by email on the cold path, so an unverified address would be an
 * account-takeover vector against someone else's server.
 */
export async function verifyBetterAuth(env: Env, token: string): Promise<AuthIdentity> {
  if (!env.BETTER_AUTH_URL) throw new AuthError('BETTER_AUTH_URL not configured')

  const cached = sessionCache.get(token)
  if (cached && cached.expiresAt > Date.now()) return cached.identity

  let res: Response
  try {
    res = await fetch(`${env.BETTER_AUTH_URL.replace(/\/$/, '')}/api/auth/get-session`, {
      headers: {
        Authorization: `Bearer ${token}`,
        // Better Auth also accepts the session as a cookie; send both so this
        // works regardless of how the client was configured to transport it.
        Cookie: `better-auth.session_token=${token}`,
      },
      signal: AbortSignal.timeout(SESSION_FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    throw new AuthError(`better-auth unreachable: ${(err as Error).message}`)
  }

  if (!res.ok) throw new AuthError(`better-auth rejected session (${res.status})`)

  let body: BetterAuthSession | null
  try {
    body = (await res.json()) as BetterAuthSession
  } catch {
    throw new AuthError('better-auth returned a malformed session')
  }

  const user = body?.user
  if (!user) throw new AuthError('no session')

  const subject = typeof user.id === 'string' ? user.id : ''
  if (!subject) throw new AuthError('no subject in session')

  const email = typeof user.email === 'string' ? user.email : ''
  if (!email) throw new AuthError('no email on account')

  // Better Auth stores emailVerified as a boolean; treat anything else as
  // unverified rather than guessing.
  const emailVerified = user.emailVerified === true
  if (!emailVerified) throw new AuthError('email not verified')

  const username =
    typeof user.username === 'string' && user.username
      ? user.username
      : typeof user.name === 'string'
        ? user.name
        : ''

  const identity: AuthIdentity = {
    subject,
    userId: subject,
    email,
    emailVerified,
    username,
    provider: 'better-auth',
  }

  sessionCache.set(token, { identity, expiresAt: Date.now() + SESSION_CACHE_TTL_MS })
  // Bound the cache: an isolate serving many users should not accumulate
  // sessions indefinitely. Cheap eviction - drop the oldest insertion.
  if (sessionCache.size > 500) {
    const oldest = sessionCache.keys().next().value
    if (oldest !== undefined) sessionCache.delete(oldest)
  }

  return identity
}
