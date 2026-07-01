/**
 * Platform-admin authorization + the billing entitlement helper.
 *
 * "Platform admin" = fleet-wide staff (moderate any server, manage plans), stored
 * in the `platform_admins` D1 table. This is DISTINCT from a per-server `links.role`
 * of 'admin', which only lets someone invite to their own box.
 *
 * The gate is the important part: it re-reads admin status from D1 on EVERY request
 * (never trusts a JWT claim or the client), so hiding the admin UI is cosmetic and
 * an admin can be revoked at runtime. Authorization is a verified Clerk identity
 * PLUS a matching platform_admins row.
 */
import type { Context } from 'hono'
import type { Env } from '../types'

/** The slice of a Hono Context resolveAdmin actually needs: the env + request
 *  headers. Typing it structurally lets both the gated admin router (which carries
 *  Variables) and the plain logs route call it without generic friction. */
type AdminLookupContext = {
  env: Env
  req: { header(name: string): string | undefined }
}
import { bearer, verifyClerk, AuthError, type ClerkIdentity } from './clerk'
import { getPlatformAdmin, backfillAdminClerkId, getEntitlement, type PlatformAdminRow } from './db'

export interface AdminContext {
  user: ClerkIdentity
  admin: PlatformAdminRow
}

/**
 * Resolve the caller as a platform admin, or null if not authenticated / not an
 * admin. Matches on clerk_user_id OR verified email (the latter supports the
 * email-seeded bootstrap row); on an email match it backfills the Clerk id so the
 * row becomes id-authoritative. Email-based matches require a VERIFIED email so an
 * unverified address can't impersonate a seeded operator.
 */
export async function resolveAdmin(c: AdminLookupContext): Promise<AdminContext | null> {
  const token = bearer(c.req.header('Authorization') ?? null)
  if (!token) return null

  let user: ClerkIdentity
  try {
    user = await verifyClerk(c.env, token)
  } catch (err) {
    if (err instanceof AuthError) return null
    throw err
  }

  // Try the stable id first; only consider the email path when Clerk asserts it
  // is verified (an unverified email must not match a seeded admin row).
  let admin = await getPlatformAdmin(c.env, { clerkUserId: user.userId })
  if (!admin && user.emailVerified) {
    admin = await getPlatformAdmin(c.env, { email: user.email })
    if (admin && admin.clerk_user_id !== user.userId) {
      // First authed sight of an email-seeded admin: pin the row to their Clerk id.
      await backfillAdminClerkId(c.env, user.email, user.userId)
      admin = { ...admin, clerk_user_id: user.userId }
    }
  }
  if (!admin) return null
  return { user, admin }
}

/**
 * Hono middleware that gates an admin sub-router. Apply once on the router so no
 * handler can ship ungated, then read the resolved context via `c.get('admin')`.
 * Returns 401 when unauthenticated, 403 when authenticated but not an admin.
 */
export async function requireAdmin(
  c: Context<{ Bindings: Env; Variables: { admin: AdminContext } }>,
  next: () => Promise<void>,
) {
  const ctx = await resolveAdmin(c)
  if (!ctx) {
    // Distinguish "no/invalid token" from "valid token, not an admin" so the SPA
    // can route a non-admin away vs. prompt a fresh sign-in.
    const hasToken = !!bearer(c.req.header('Authorization') ?? null)
    return c.json({ error: hasToken ? 'forbidden' : 'unauthorized' }, hasToken ? 403 : 401)
  }
  c.set('admin', ctx)
  await next()
}

/**
 * The user's plan. D1 entitlements is the SOLE source of truth - we deliberately
 * never trust a plan claim carried in a JWT (the SUI audit flagged exactly that
 * as a self-grant hole). Absent row = 'free'.
 */
export async function getPlan(env: Env, clerkUserId: string): Promise<'free' | 'pro'> {
  const row = await getEntitlement(env, clerkUserId)
  return row?.plan === 'pro' ? 'pro' : 'free'
}
