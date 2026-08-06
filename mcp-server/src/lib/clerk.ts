/**
 * Clerk session verification.
 *
 * Mirrors control-plane/src/lib/clerk.ts - same JWKS, same claim names, same
 * verified-email requirement. Kept as a small local copy rather than an import
 * because the two Workers deploy independently and share no build.
 *
 * DIFFERENCE FROM THE CONTROL PLANE: the `azp` (authorized party) check allows
 * the SPA origin only. The MCP Worker never receives a Clerk token minted for
 * itself - the token always arrives via the SPA's sign-in bounce, so the SPA
 * origin is the correct and only expected party.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { Env } from '../types'

const EMAIL_CLAIM = 'email'
const EMAIL_VERIFIED_CLAIM = 'email_verified'
const USERNAME_CLAIM = 'username'

export interface ClerkIdentity {
  userId: string
  email: string
  emailVerified: boolean
  username: string
}

export class AuthError extends Error {}

// Cache the remote JWKS across requests (Workers reuse isolates).
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getJwks(url: string) {
  let set = jwksCache.get(url)
  if (!set) {
    set = createRemoteJWKSet(new URL(url))
    jwksCache.set(url, set)
  }
  return set
}

/** Verify a Clerk session token. Throws AuthError on any failure. */
export async function verifyClerk(env: Env, token: string): Promise<ClerkIdentity> {
  if (!env.CLERK_JWKS_URL) throw new AuthError('CLERK_JWKS_URL not configured')

  let payload: Record<string, unknown>
  try {
    const result = await jwtVerify(token, getJwks(env.CLERK_JWKS_URL))
    payload = result.payload as Record<string, unknown>
  } catch (err) {
    throw new AuthError(`clerk verify failed: ${(err as Error).message}`)
  }

  const userId = typeof payload.sub === 'string' ? payload.sub : ''
  if (!userId) throw new AuthError('no subject in token')

  const expected = (env.APP_ORIGIN || 'https://app.hearthshelf.com').replace(/\/$/, '')
  const azp = typeof payload.azp === 'string' ? payload.azp.replace(/\/$/, '') : ''
  if (azp && azp !== expected) throw new AuthError('unauthorized party')

  const email = typeof payload[EMAIL_CLAIM] === 'string' ? (payload[EMAIL_CLAIM] as string) : ''
  const emailVerified = payload[EMAIL_VERIFIED_CLAIM] === true
  if (!email) throw new AuthError('no email claim - add it to the Clerk JWT template')

  const username =
    typeof payload[USERNAME_CLAIM] === 'string' ? (payload[USERNAME_CLAIM] as string) : ''

  return { userId, email, emailVerified, username }
}
