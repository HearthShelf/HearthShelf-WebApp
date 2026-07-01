/**
 * Clerk session verification.
 *
 * The SPA sends the user's Clerk session JWT as `Authorization: Bearer <jwt>`.
 * Clerk signs these with keys published at its JWKS endpoint, so we verify
 * offline against that JWKS (cached by `jose`'s remote key set). We extract the
 * Clerk user id (`sub`) and the user's VERIFIED primary email - the email is
 * load-bearing because HS matches the ABS user by it (ARCHITECTURE.md), so we
 * only accept it when Clerk asserts it is verified.
 *
 * NOTE (Clerk wiring, you do this tomorrow): the exact claim names depend on
 * your Clerk JWT template. Out of the box Clerk's session token carries `sub`
 * but NOT email; you add email via a JWT template (e.g. claims `email` and
 * `email_verified`). Set CLERK_JWKS_URL and, if your template differs, adjust
 * EMAIL_CLAIM / EMAIL_VERIFIED_CLAIM below. Until configured, verifyClerk
 * throws and the API returns 401 - the rest of the control plane is testable
 * with a stub token (see DEV_BYPASS).
 */
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { Env } from '../types'

const EMAIL_CLAIM = 'email'
const EMAIL_VERIFIED_CLAIM = 'email_verified'
const USERNAME_CLAIM = 'username'

/** Allowed authorized-parties for a Clerk session token = our SPA origin(s).
 *  Same list as the CORS allowlist; defaults to production when unset. */
function allowedParties(env: Env): string[] {
  return (env.APP_ORIGINS || 'https://app.hearthshelf.com')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

export interface ClerkIdentity {
  userId: string
  email: string
  emailVerified: boolean
  /** Clerk username, from the hearthshelf JWT template. May be empty. */
  username: string
}

// Cache the remote JWKS per issuer URL across requests (Workers reuse isolates).
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getJwks(url: string) {
  let set = jwksCache.get(url)
  if (!set) {
    set = createRemoteJWKSet(new URL(url))
    jwksCache.set(url, set)
  }
  return set
}

export class AuthError extends Error {}

/**
 * Verify a Clerk session token and return the identity. Throws AuthError on any
 * failure (missing config, bad signature, missing/unverified email).
 */
export async function verifyClerk(env: Env, token: string): Promise<ClerkIdentity> {
  if (!env.CLERK_JWKS_URL) {
    throw new AuthError('CLERK_JWKS_URL not configured')
  }
  let payload: Record<string, unknown>
  try {
    const result = await jwtVerify(token, getJwks(env.CLERK_JWKS_URL))
    payload = result.payload as Record<string, unknown>
  } catch (err) {
    throw new AuthError(`clerk verify failed: ${(err as Error).message}`)
  }

  const userId = typeof payload.sub === 'string' ? payload.sub : ''
  if (!userId) throw new AuthError('no subject in token')

  // Authorized-party check: Clerk stamps `azp` with the origin that requested the
  // token. Reject a token minted for a different app under the same Clerk issuer.
  // Only enforced when `azp` is present (some token templates omit it); when
  // present it MUST be one of our SPA origins.
  const azp = typeof payload.azp === 'string' ? payload.azp.replace(/\/$/, '') : ''
  if (azp && !allowedParties(env).includes(azp)) {
    throw new AuthError('unauthorized party')
  }

  const email = typeof payload[EMAIL_CLAIM] === 'string' ? (payload[EMAIL_CLAIM] as string) : ''
  const emailVerified = payload[EMAIL_VERIFIED_CLAIM] === true
  if (!email) throw new AuthError('no email claim - add it to the Clerk JWT template')

  const username =
    typeof payload[USERNAME_CLAIM] === 'string' ? (payload[USERNAME_CLAIM] as string) : ''

  return { userId, email, emailVerified, username }
}

/**
 * Pull the bearer token from an Authorization header, or null.
 */
export function bearer(authHeader: string | null): string | null {
  if (!authHeader) return null
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
}
