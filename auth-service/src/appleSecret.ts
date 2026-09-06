/**
 * Apple's client secret, minted per request.
 *
 * Apple is the only provider that does not issue a client secret. You sign one
 * yourself - an ES256 JWT over your team id, key id and .p8 private key - and
 * Apple caps its lifetime at six months. Stored as a static secret that becomes
 * a calendar obligation: miss the rotation and Apple sign-in dies with a
 * generic `invalid_client`, on a date nobody remembers setting.
 *
 * So we do not store the JWT. We store the .p8 key (base64, because a PEM's
 * newlines do not survive every secret-setting path cleanly) and sign a short
 * one on demand. Nothing outlives a request, so there is nothing to rotate -
 * the only credential on file is the .p8 itself, which Apple does not expire.
 *
 * The signed token is cached in-isolate for a few minutes so a burst of
 * sign-ins does not re-sign per request; Workers reuse isolates, and ES256
 * signing is cheap but not free.
 */
import { SignJWT, importPKCS8 } from 'jose'
import type { Env } from './types'

/** How long a minted secret is reused within an isolate. */
const CACHE_TTL_MS = 5 * 60_000

/** Lifetime stamped on the JWT. Short by design - it is minted per request, so
 *  there is no reason to hand Apple anything long-lived. Comfortably above the
 *  cache TTL so a cached token is never near expiry when used. */
const TOKEN_TTL_SEC = 30 * 60

let cached: { token: string; expiresAt: number } | null = null

/** Decode a base64 .p8 back to PEM. */
function decodeKey(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ''))
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Mint (or reuse) the Apple client secret.
 *
 * Returns undefined when Apple is not configured, which is how the caller
 * decides whether to register the provider at all.
 */
export async function getAppleClientSecret(env: Env): Promise<string | undefined> {
  // A pre-signed secret still wins if one is set: it keeps a manual override
  // available (and any deployment already using one keeps working).
  if (env.APPLE_CLIENT_SECRET) return env.APPLE_CLIENT_SECRET

  if (!env.APPLE_PRIVATE_KEY_B64 || !env.APPLE_TEAM_ID || !env.APPLE_KEY_ID || !env.APPLE_CLIENT_ID)
    return undefined

  if (cached && cached.expiresAt > Date.now()) return cached.token

  const key = await importPKCS8(decodeKey(env.APPLE_PRIVATE_KEY_B64), 'ES256')
  const now = Math.floor(Date.now() / 1000)

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: env.APPLE_KEY_ID })
    .setIssuer(env.APPLE_TEAM_ID)
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_SEC)
    .setAudience('https://appleid.apple.com')
    // The SERVICES ID (web sign-in identifier), not the app's bundle id. The
    // bundle id yields tokens Apple rejects with a generic invalid_client.
    .setSubject(env.APPLE_CLIENT_ID)
    .sign(key)

  cached = { token, expiresAt: Date.now() + CACHE_TTL_MS }
  return token
}
