/**
 * Identifier + secret generation, all via the Web Crypto API available in
 * Workers. No Node 'crypto' import needed.
 */

export function uuid(): string {
  return crypto.randomUUID()
}

/**
 * A human-enterable pairing code: 8 chars from an unambiguous alphabet
 * (no 0/O/1/I/L), grouped as XXXX-XXXX. ~40 bits of entropy, one-time use,
 * short TTL - plenty for a redeem-once code.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function pairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length]
    if (i === 3) out += '-'
  }
  return out
}

/** A long opaque secret (base64url) the HS server uses to authenticate itself. */
export function serverSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return b64url(bytes)
}

/**
 * A human-enterable invite code: XXXX-XXXX from the unambiguous alphabet, same
 * shape as pairingCode. Short enough to read off a screen and type into a phone,
 * which is the point - the invite email carries it as a link, but a user who
 * never got the email can be read the code over the phone instead.
 *
 * ~40 bits. That is NOT unguessable the way the old 256-bit token was, so
 * redemption MUST stay guarded: /invite/accept rate-limits attempts per IP and
 * codes expire (INVITE_TTL_MS). Do not lengthen the TTL or drop the limiter
 * without lengthening the code.
 */
export function inviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length]
    if (i === 3) out += '-'
  }
  return out
}

/**
 * Normalize a user-typed invite code for lookup: uppercase, strip everything
 * outside the alphabet, re-insert the dash. Lets "4g7k p2wd", "4G7KP2WD", and
 * "4G7K-P2WD" all match the stored form.
 */
export function normalizeInviteCode(raw: string): string {
  const bare = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (bare.length !== 8) return ''
  for (const ch of bare) if (!ALPHABET.includes(ch)) return ''
  return `${bare.slice(0, 4)}-${bare.slice(4)}`
}

export function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** SHA-256 hash of a secret, hex-encoded, for at-rest storage + comparison. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Constant-time-ish string compare to avoid timing leaks on secret checks. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Salted hash of a shared-screen PIN. A 4-digit PIN has only ~13 bits of
 *  entropy, so this is NOT a strong secret - the salt just stops a stolen DB
 *  from revealing PINs by inspection, and the switch endpoint rate-limits
 *  attempts. Returns { hash, salt } to store; verify with verifyPin. */
export async function hashPin(pin: string): Promise<{ hash: string; salt: string }> {
  const salt = b64url(crypto.getRandomValues(new Uint8Array(16)))
  const hash = await sha256Hex(`${salt}:${pin}`)
  return { hash, salt }
}

export async function verifyPin(pin: string, hash: string, salt: string): Promise<boolean> {
  const candidate = await sha256Hex(`${salt}:${pin}`)
  return timingSafeEqual(candidate, hash)
}

export function now(): number {
  return Date.now()
}
