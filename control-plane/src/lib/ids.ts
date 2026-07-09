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
 * A long opaque invite token (base64url, ~256 bits). Carried in the invite link
 * as a bearer capability: whoever follows the link and authenticates claims the
 * invite, so it must be unguessable. Delivered only to the invited email.
 */
export function inviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return b64url(bytes)
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
