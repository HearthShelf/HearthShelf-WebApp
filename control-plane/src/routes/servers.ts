/**
 * Server registry + grant minting.
 *
 * User-facing (Clerk-authenticated), called by the SPA:
 *   GET    /servers               - list linked servers (+ accept pending invites)
 *   POST   /servers/:id/grant     - mint a short-TTL grant for one server
 *   DELETE /servers/:id           - unlink a server from this user
 *   POST   /servers/:id/invite    - invite someone by email (admin only)
 *   GET    /servers/:id/invites   - list pending invites (admin only)
 *
 * Server-to-server (HS authenticates with its server secret), optional path:
 *   POST   /servers/grant        - reserved for a future server-pull model;
 *                                  the default flow is the SPA minting grants
 *                                  it then hands to the browser/HS. Kept as a
 *                                  documented stub so the URL we advertise at
 *                                  pairing time resolves.
 */
import { Hono, type Context } from 'hono'
import type { Env, LinkedServerDTO } from '../types'
import { bearer, verifyClerk, AuthError, type ClerkIdentity } from '../lib/clerk'
import {
  listLinksForUser,
  getLink,
  deleteLink,
  getServer,
  createLink,
  upsertInvite,
  pendingInvitesForEmail,
  pendingInvitesForServer,
  markInviteAccepted,
} from '../lib/db'
import { mintGrant } from '../lib/signing'
import { createClerkInvitation, ClerkApiError } from '../lib/clerkApi'
import { uuid, sha256Hex, timingSafeEqual } from '../lib/ids'

export const servers = new Hono<{ Bindings: Env }>()

/** Resolve the Clerk identity, or null if the request is not authenticated. */
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

/**
 * Turn any pending invites for this verified email into real links. This is how
 * an invitee gets connected without a pairing code: the admin invited their
 * email; on their first authed call we match and materialize. Only acts on a
 * VERIFIED email so an unverified address can't claim someone else's invite.
 */
async function acceptPendingInvites(c: Context<{ Bindings: Env }>, user: ClerkIdentity) {
  if (!user.emailVerified) return
  const invites = await pendingInvitesForEmail(c.env, user.email)
  for (const inv of invites) {
    await createLink(c.env, {
      id: uuid(),
      clerkUserId: user.userId,
      serverId: inv.server_id,
      email: user.email,
      role: inv.role,
      displayName: inv.server_name,
    })
    await markInviteAccepted(c.env, inv.id)
  }
}

servers.get('/servers', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  // Materialize any invites waiting on this email before listing.
  await acceptPendingInvites(c, user)

  const links = await listLinksForUser(c.env, user.userId)
  const out: LinkedServerDTO[] = links.map((l) => ({
    id: l.server_id,
    name: l.display_name || l.server_name || l.public_url,
    url: l.public_url,
    role: l.role,
  }))
  return c.json({ servers: out })
})

servers.post('/servers/:id/grant', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  if (!user.emailVerified) return c.json({ error: 'email_unverified' }, 403)

  const serverId = c.req.param('id')
  const link = await getLink(c.env, user.userId, serverId)
  if (!link) return c.json({ error: 'not_linked' }, 404)
  const server = await getServer(c.env, serverId)
  if (!server) return c.json({ error: 'server_unknown' }, 404)

  const token = await mintGrant(c.env, {
    clerkUserId: user.userId,
    serverId,
    serverUrl: server.public_url,
    email: link.email,
    username: user.username,
    role: link.role,
  })
  return c.json({
    grant: token,
    server: { id: serverId, url: server.public_url },
    expires_in: Number(c.env.GRANT_TTL_SECONDS || '300'),
  })
})

servers.delete('/servers/:id', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  await deleteLink(c.env, user.userId, c.req.param('id'))
  return c.json({ ok: true })
})

const APP_ORIGIN = 'https://app.hearthshelf.com'

function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

/**
 * Invite someone by email to a server. Admin-only (the inviter must have an
 * admin link to the server). Creates a Clerk invitation (emails a sign-up link)
 * and records a pending invite that materializes into a link on the invitee's
 * first sign-in. Re-inviting refreshes the existing pending row.
 */
servers.post('/servers/:id/invite', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const serverId = c.req.param('id')
  const inviterLink = await getLink(c.env, user.userId, serverId)
  if (!inviterLink) return c.json({ error: 'not_linked' }, 404)
  if (inviterLink.role !== 'admin') return c.json({ error: 'forbidden', detail: 'admin only' }, 403)

  let body: { email?: string; role?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const email = normalizeEmail(body.email)
  if (!email || !email.includes('@')) return c.json({ error: 'invalid_email' }, 400)
  const role: 'admin' | 'user' = body.role === 'admin' ? 'admin' : 'user'

  // Create the Clerk invitation. If they already have a Clerk account, Clerk may
  // 422 "duplicate" - that's fine; the pending invite still links them on next
  // sign-in. We record the invite regardless.
  let clerkInvitationId: string | null = null
  try {
    const inv = await createClerkInvitation(c.env, {
      email,
      redirectUrl: `${APP_ORIGIN}/sign-up`,
      serverId,
      role,
    })
    clerkInvitationId = inv.id
  } catch (err) {
    if (!(err instanceof ClerkApiError)) throw err
    // Non-fatal: log via response detail; still record the pending invite so an
    // existing user gets linked on next sign-in.
    clerkInvitationId = null
  }

  await upsertInvite(c.env, {
    id: uuid(),
    email,
    serverId,
    role,
    invitedBy: user.userId,
    clerkInvitationId,
  })

  return c.json({ ok: true, email, role, emailed: clerkInvitationId !== null })
})

/** List pending invites for a server (admin-only). */
servers.get('/servers/:id/invites', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const serverId = c.req.param('id')
  const link = await getLink(c.env, user.userId, serverId)
  if (!link || link.role !== 'admin') return c.json({ error: 'forbidden' }, 403)
  const invites = await pendingInvitesForServer(c.env, serverId)
  return c.json({
    invites: invites.map((i) => ({ email: i.email, role: i.role, created_at: i.created_at })),
  })
})

/**
 * Server-initiated invite. A paired HS server (whose own admin authorized this)
 * invites someone, authenticating with its server_secret rather than a Clerk
 * token. Same outcome as the user-facing invite: Clerk invitation + pending
 * link. Lets admins invite from inside their self-hosted HS UI.
 */
servers.post('/servers/invite-from-server', async (c) => {
  let body: { server_id?: string; server_secret?: string; email?: string; role?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const serverId = (body.server_id || '').trim()
  const secret = body.server_secret || ''
  if (!serverId || !secret) return c.json({ error: 'server_id and server_secret required' }, 400)

  const server = await getServer(c.env, serverId)
  if (!server) return c.json({ error: 'server_unknown' }, 404)
  const presented = await sha256Hex(secret)
  if (!timingSafeEqual(presented, server.server_secret_hash)) {
    return c.json({ error: 'bad_server_secret' }, 401)
  }

  const email = normalizeEmail(body.email)
  if (!email || !email.includes('@')) return c.json({ error: 'invalid_email' }, 400)
  const role: 'admin' | 'user' = body.role === 'admin' ? 'admin' : 'user'

  let clerkInvitationId: string | null = null
  try {
    const inv = await createClerkInvitation(c.env, {
      email,
      redirectUrl: `${APP_ORIGIN}/sign-up`,
      serverId,
      role,
    })
    clerkInvitationId = inv.id
  } catch (err) {
    if (!(err instanceof ClerkApiError)) throw err
    clerkInvitationId = null
  }

  await upsertInvite(c.env, {
    id: uuid(),
    email,
    serverId,
    role,
    invitedBy: 'server',
    clerkInvitationId,
  })

  return c.json({ ok: true, email, role, emailed: clerkInvitationId !== null })
})

// Documented stub for the advertised grant_url. The shipping design mints
// grants via the user-authenticated /servers/:id/grant above and the client
// carries the grant to HS - the control plane is never in the data path. This
// endpoint exists so the URL we hand HS at pairing time returns a clear 501
// rather than a 404 if anything calls it.
servers.post('/servers/grant', (c) =>
  c.json(
    { error: 'not_implemented', detail: 'use POST /servers/:id/grant (user-authenticated)' },
    501
  )
)
