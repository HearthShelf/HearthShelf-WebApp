/**
 * Account data deletion (Google Play data-safety compliance).
 *
 *   POST /account/delete   purge all of this user's control-plane + log data,
 *                          then delete their Clerk identity outright.
 *
 * Order matters: our own data is purged FIRST, the Clerk identity LAST. Every
 * step here is authenticated by the Clerk bearer token, so once the Clerk
 * identity is gone the user can no longer prove who they are - doing it last
 * means a mid-flight failure never leaves the user locked out of finishing
 * their own deletion request.
 *
 * Not touched: `pending_invites` (keyed by email, represents invites this user
 * SENT to someone else - not their own data) and `admin_audit` (an operational
 * record of actions, not personal profile data; this flow adds one final entry
 * to it rather than scrubbing history).
 */
import { Hono, type Context } from 'hono'
import type { Env } from '../types'
import { bearer } from '../lib/clerk'
import { verifyIdentity, AuthError, type AuthIdentity } from '../lib/identity'
import {
  deleteAllLinksForUser,
  deleteUserPrefs,
  deleteEntitlement,
  deleteAllDeviceHandlesForUser,
  writeAudit,
} from '../lib/db'
import { deleteClerkUser, ClerkApiError } from '../lib/clerkApi'
import { uuid } from '../lib/ids'

export const account = new Hono<{ Bindings: Env }>()

async function requireUser(c: Context<{ Bindings: Env }>): Promise<AuthIdentity | null> {
  const token = bearer(c.req.header('Authorization') ?? null)
  if (!token) return null
  try {
    return await verifyIdentity(c.env, token)
  } catch (err) {
    if (err instanceof AuthError) return null
    throw err
  }
}

account.post('/account/delete', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  await Promise.all([
    deleteAllLinksForUser(c.env, user.userId),
    deleteUserPrefs(c.env, user.userId),
    deleteEntitlement(c.env, user.userId),
    deleteAllDeviceHandlesForUser(c.env, user.userId),
  ])

  // Crash reports used to be purged from our own log store here. That store is
  // gone - reports now go to the error dashboard, which keeps them for a fixed
  // retention window and expires them on its own. Nothing to purge.

  await writeAudit(c.env, {
    id: uuid(),
    actor: user.userId,
    action: 'account.self_delete',
    target: user.userId,
  })

  try {
    await deleteClerkUser(c.env, user.userId)
  } catch (err) {
    const detail = err instanceof ClerkApiError ? err.message : String(err)
    // Our data is already gone at this point - say so honestly rather than
    // letting the client believe nothing happened.
    return c.json({ error: 'clerk_delete_failed', ourDataDeleted: true, detail }, 500)
  }

  return c.json({ ok: true })
})
