/**
 * Account data deletion (Google Play data-safety compliance, and GDPR erasure).
 *
 *   POST /account/delete   purge all of this user's control-plane data.
 *
 * THIS ROUTE NO LONGER DELETES THE SIGN-IN IDENTITY, and that is deliberate.
 * It used to finish by calling Clerk's admin API. After the move to Better
 * Auth that call could only ever 404 - Clerk has no such user - and a 404 was
 * treated here as "already deleted", so the route reported `ok: true` while the
 * account it claimed to have deleted was still perfectly able to sign in. A
 * deletion that silently does not delete is worse than one that fails loudly.
 *
 * The identity is now deleted by the CLIENT, calling Better Auth's own
 * `deleteUser` with the user's own session, which is email-confirmed (see the
 * auth service's `sendDeleteAccountVerification`). That is also the only way it
 * can work: this Worker holds no admin credential for the auth service, so it
 * cannot delete somebody else's account, and minting one purely to delete
 * accounts would be a far larger key to guard than this flow deserves.
 *
 * Order still matters, for the same reason it did before: our data goes FIRST,
 * the identity LAST. Every call here is authenticated by the user's own bearer
 * token, so once the identity is gone the user can no longer prove who they
 * are - purging first means a mid-flight failure never leaves someone locked
 * out of finishing their own deletion request.
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

  // `identityPending` tells the client the job is only half done: our data is
  // gone, and it must now delete the sign-in identity itself. Saying so
  // explicitly is what stops this route from ever again reporting a deletion it
  // did not perform.
  return c.json({ ok: true, identityPending: true })
})
