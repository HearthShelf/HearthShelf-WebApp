/**
 * Device-local account switcher (see ../../docs/account-switcher-plan.md).
 *
 * Clerk multi-session is paid, so the browser holds one live session. To swap
 * between accounts on a shared screen without storing passwords, each remembered
 * account gets an opaque device handle. On a swap the SPA presents the handle
 * (as the currently-signed-in user) and we mint a fresh single-use Clerk sign-in
 * token for the mapped account, which the browser redeems via the ticket flow.
 *
 * Routes (all Clerk-authenticated):
 *   POST   /accounts/remember              remember the CURRENT user on this device
 *   POST   /accounts/switch-token          mint a sign-in ticket for a handle
 *   GET    /accounts/remembered            refresh label/avatar/pin snapshots
 *   DELETE /accounts/remembered/:handle    forget an account on this device
 *
 * The handle authorizes REQUESTING a switch, not being signed in; every mint
 * goes through Clerk and handles are revocable + short-lived.
 *
 * PIN scope: a PIN lives on the device_handles ROW, i.e. it is per remembered
 * device, not per Clerk account. The same person remembering their account on
 * two devices sets two independent PINs; forgetting/changing one never touches
 * the other. Forgetting a PIN-protected handle normally requires that PIN
 * (re-verified here, same as switch-token); the `confirm_forgot` escape hatch
 * lets a caller who forgot the PIN remove the handle anyway after an explicit
 * client-side confirmation - this only closes the swap path for THIS remembered
 * device row, it does not touch the account's session anywhere else.
 */
import { Hono, type Context } from 'hono'
import type { Env } from '../types'
import { bearer, verifyClerk, AuthError, type ClerkIdentity } from '../lib/clerk'
import {
  createDeviceHandle,
  getDeviceHandle,
  touchDeviceHandle,
  deleteDeviceHandle,
  bumpPinAttempts,
  resetPinAttempts,
  type DeviceHandleRow,
} from '../lib/db'
import { serverSecret, hashPin, verifyPin, now } from '../lib/ids'
import { createSignInToken, ClerkApiError } from '../lib/clerkApi'

export const accounts = new Hono<{ Bindings: Env }>()

/** How long a remembered handle stays valid without use (ms). 30 days. */
const HANDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Sign-in ticket TTL (seconds) - redeemed immediately, so keep it tight. */
const TICKET_TTL_SEC = 60
/** Wrong-PIN attempts before the handle is forgotten and a full re-login is
 *  forced. Bounds brute-force of the 4-digit (10k) PIN space. */
const MAX_PIN_ATTEMPTS = 10

async function requireUser(c: Context<{ Bindings: Env }>): Promise<ClerkIdentity | null> {
  const token = bearer(c.req.header('Authorization') ?? null)
  if (!token) return null
  try {
    return await verifyClerk(c.env, token)
  } catch (err) {
    if (err instanceof AuthError) return null
    throw err
  }
}

type PinCheck =
  | { ok: true }
  | { ok: false; status: 403; error: 'pin_required'; attemptsLeft: number }
  | { ok: false; status: 410; error: 'locked_out' }

/**
 * Verify a PIN against a handle row, bumping/resetting the shared attempt
 * counter and enforcing the lockout. Used by both switch-token and the forget
 * flow, so a PIN guesser can't reset their budget by switching endpoints. On
 * lockout the handle is deleted (shared fate: too many wrong guesses forgets
 * the account here, whether you were trying to switch in or forget it).
 */
async function checkPin(env: Env, row: DeviceHandleRow, pin: string): Promise<PinCheck> {
  if (!row.pin_hash || !row.pin_salt) return { ok: true }
  if (pin && (await verifyPin(pin, row.pin_hash, row.pin_salt))) {
    if (row.pin_attempts > 0) await resetPinAttempts(env, row.handle)
    return { ok: true }
  }
  // Only count an actual attempt, not a bare probe with no PIN, so opening the
  // pad doesn't burn tries.
  if (!pin) {
    return { ok: false, status: 403, error: 'pin_required', attemptsLeft: MAX_PIN_ATTEMPTS - row.pin_attempts }
  }
  const attempts = await bumpPinAttempts(env, row.handle)
  if (attempts >= MAX_PIN_ATTEMPTS) {
    await deleteDeviceHandle(env, row.handle)
    return { ok: false, status: 410, error: 'locked_out' }
  }
  return { ok: false, status: 403, error: 'pin_required', attemptsLeft: MAX_PIN_ATTEMPTS - attempts }
}

/**
 * Remember the CURRENT (signed-in) user on this device. Returns the opaque
 * handle the browser stores. An optional PIN gates future switches into this
 * account (shared-screen privacy). Snapshots label/avatar so the roster renders
 * without a Clerk round-trip.
 */
accounts.post('/accounts/remember', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  let body: { pin?: string; label?: string; image_url?: string } = {}
  try {
    body = await c.req.json()
  } catch {
    // An empty body is fine here (remember with no PIN / no snapshot).
  }
  const pin = typeof body.pin === 'string' ? body.pin.trim() : ''
  if (pin && !/^\d{4}$/.test(pin)) return c.json({ error: 'bad_pin' }, 400)

  const handle = serverSecret()
  const pinParts = pin ? await hashPin(pin) : null

  await createDeviceHandle(c.env, {
    handle,
    clerkUserId: user.userId,
    label: body.label ?? user.username ?? user.email,
    imageUrl: body.image_url ?? null,
    pinHash: pinParts?.hash ?? null,
    pinSalt: pinParts?.salt ?? null,
    expiresAt: now() + HANDLE_TTL_MS,
  })

  return c.json({
    handle,
    label: body.label ?? user.username ?? user.email,
    has_pin: !!pin,
  })
})

/**
 * Mint a single-use Clerk sign-in ticket for a remembered handle. The caller
 * must be signed in as SOMEONE (anti-abuse: a ticket is only mintable from an
 * authenticated browser). If the handle has a PIN, the PIN is re-checked here -
 * the client gate is never trusted alone.
 */
accounts.post('/accounts/switch-token', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  let body: { handle?: string; pin?: string } = {}
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'bad_request' }, 400)
  }
  const handle = typeof body.handle === 'string' ? body.handle : ''
  if (!handle) return c.json({ error: 'bad_request' }, 400)

  const row = await getDeviceHandle(c.env, handle)
  if (!row) return c.json({ error: 'unknown_handle' }, 404)

  const pinCheck = await checkPin(c.env, row, typeof body.pin === 'string' ? body.pin : '')
  if (!pinCheck.ok) {
    if (pinCheck.error === 'locked_out') return c.json({ error: 'locked_out' }, 410)
    return c.json({ error: 'pin_required', attempts_left: pinCheck.attemptsLeft }, 403)
  }

  let ticket: string
  try {
    const t = await createSignInToken(c.env, {
      userId: row.clerk_user_id,
      expiresInSeconds: TICKET_TTL_SEC,
    })
    ticket = t.token
  } catch (err) {
    if (err instanceof ClerkApiError) {
      return c.json({ error: 'mint_failed', detail: err.message }, 502)
    }
    throw err
  }

  await touchDeviceHandle(c.env, handle)
  return c.json({ ticket, expires_in: TICKET_TTL_SEC })
})

/**
 * Refresh the roster snapshot for the handles the browser presents. The browser
 * is the source of truth for WHICH handles it holds; this just returns current
 * label/avatar/pin-presence for the ones that are still valid, and silently
 * drops any that were revoked or expired so the SPA can prune them.
 */
accounts.get('/accounts/remembered', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const raw = c.req.query('handles') ?? ''
  const handles = raw.split(',').map((h) => h.trim()).filter(Boolean).slice(0, 20)

  const out: Array<{ handle: string; label: string | null; image_url: string | null; has_pin: boolean }> = []
  for (const h of handles) {
    const row = await getDeviceHandle(c.env, h)
    if (row) out.push({ handle: row.handle, label: row.label, image_url: row.image_url, has_pin: !!row.pin_hash })
  }
  return c.json({ accounts: out })
})

/**
 * Forget an account on this device. Any authenticated browser holding the
 * handle can forget it - matching the shared-screen model where the device
 * owner manages the roster.
 *
 * If the handle has a PIN, forgetting it normally requires that PIN (re-checked
 * here, sharing the same attempt counter/lockout as switch-token). The
 * `confirm_forgot: true` escape hatch skips the PIN check entirely, for the
 * "I forgot my PIN" flow - the SPA must have already shown an explicit
 * confirmation ("this removes {name} from this device") before setting it, since
 * this endpoint has no other way to tell a forgotten PIN from an attacker who
 * just wants the row gone. This only removes the LOCAL handle; it never touches
 * the account's session on this or any other device.
 */
accounts.delete('/accounts/remembered/:handle', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const handle = c.req.param('handle')
  const row = await getDeviceHandle(c.env, handle)
  if (!row) return c.json({ ok: true }) // already gone - forgetting is idempotent

  let body: { pin?: string; confirm_forgot?: boolean } = {}
  try {
    body = await c.req.json()
  } catch {
    // No body at all is fine for a PIN-less handle.
  }

  if (!body.confirm_forgot) {
    const pinCheck = await checkPin(c.env, row, typeof body.pin === 'string' ? body.pin : '')
    if (!pinCheck.ok) {
      // Lockout already deleted the row inside checkPin.
      if (pinCheck.error === 'locked_out') return c.json({ ok: true })
      return c.json({ error: 'pin_required', attempts_left: pinCheck.attemptsLeft }, 403)
    }
  }

  await deleteDeviceHandle(c.env, handle)
  return c.json({ ok: true })
})
