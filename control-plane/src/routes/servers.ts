/**
 * Server registry + grant minting.
 *
 * User-facing (Clerk-authenticated), called by the SPA:
 *   GET    /servers               - list linked servers (+ accept pending invites)
 *   POST   /servers/:id/grant     - mint a short-TTL grant for one server
 *   DELETE /servers/:id           - unlink a server from this user
 *   POST   /servers/:id/default   - set this server as the user's default
 *   DELETE /servers/:id/default   - clear the user's default server
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
  touchServer,
  setServerName,
  deleteServer,
  createLink,
  upsertInvite,
  inviteByToken,
  revokeInvite,
  pendingInvitesForEmail,
  pendingInvitesForServer,
  markInviteAccepted,
  bumpInviteAttempts,
  updateServerPublicUrl,
  upsertServerCertPending,
  recordServerCertResult,
  getServerCert,
  getDefaultServer,
  setDefaultServer,
  clearDefaultServerIf,
  setServerSecretHash,
  setServerVersion,
  writeAudit,
} from '../lib/db'
import { getLatestReleaseFresh, toDTO } from '../lib/releases'
import { mintGrant } from '../lib/signing'
import { getPlan } from '../lib/admin'
import { mintCertGrant, hsDirectZone } from '../lib/certBroker'
import { sendEmail, EmailError } from '../lib/email'
import { renderInviteEmail } from '../lib/emailTemplates'
import {
  uuid,
  sha256Hex,
  timingSafeEqual,
  serverSecret,
  inviteCode,
  normalizeInviteCode,
} from '../lib/ids'
import { probeServer, validatePublicUrl, type ProbeStatus } from '../lib/reachability'

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

/** Failed-guess budget for the short invite code, per account per window. Ten
 *  wrong codes an hour leaves ~40 bits astronomically out of reach while never
 *  bothering a real invitee, who typically gets it right the first time. */
const MAX_INVITE_ATTEMPTS = 10
const INVITE_ATTEMPT_WINDOW_MS = 60 * 60 * 1000

/**
 * Accept an invite by its code. This is the relay-proof path: the code is a
 * bearer capability delivered to the invited email (or read aloud by the
 * inviter), so possession of it plus an authenticated session authorizes the
 * link regardless of what email the account carries. This is what makes invites
 * work for Sign in with Apple "Hide My Email" users, whose account email is a
 * @privaterelay address that never matches the invited one.
 *
 * Intentionally does NOT require a verified email: the code, not the email, is
 * the proof. The code is single-use (marked accepted) and re-minted on every
 * re-invite, so a claimed or superseded code is inert.
 *
 * Because the code is short (~40 bits), two guards are load-bearing here and
 * must not be removed independently of lengthening it: expiry (enforced in
 * inviteByToken) and the per-account attempt limit below.
 */
servers.post('/invite/accept', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  let body: { token?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const raw = typeof body.token === 'string' ? body.token.trim() : ''
  if (!raw) return c.json({ error: 'invalid_token' }, 400)
  // Accept whatever shape the user typed: "4g7k p2wd", "4G7KP2WD", "4G7K-P2WD".
  const token = normalizeInviteCode(raw)
  if (!token) return c.json({ error: 'invalid_token' }, 400)

  const inv = await inviteByToken(c.env, token)
  // Not found / expired / already accepted / revoked all look the same to the
  // caller so a code can't be probed for validity beyond "this one is live".
  if (!inv) {
    // The code is short, so a wrong guess has to cost something. Count failures
    // per account and cut them off well before ~40 bits is reachable.
    const attempts = await bumpInviteAttempts(c.env, user.userId, INVITE_ATTEMPT_WINDOW_MS)
    if (attempts > MAX_INVITE_ATTEMPTS) return c.json({ error: 'too_many_attempts' }, 429)
    return c.json({ error: 'invite_not_found' }, 404)
  }

  await createLink(c.env, {
    id: uuid(),
    clerkUserId: user.userId,
    serverId: inv.server_id,
    email: user.email,
    role: inv.role,
    displayName: inv.server_name,
  })
  await markInviteAccepted(c.env, inv.id)

  return c.json({ ok: true, serverId: inv.server_id })
})

/**
 * The signed-in user's own plan/entitlement. D1 entitlements is the sole source
 * of truth (getPlan never trusts a JWT claim). This is the read the Account
 * screen's subscription section renders - "plan state from day one", before any
 * billing provider is wired. `source` lets the UI distinguish a manually granted
 * plan from a future billing-synced one without leaking billing internals.
 */
servers.get('/me/plan', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const plan = await getPlan(c.env, user.userId)
  return c.json({ plan })
})

servers.get('/servers', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  // Materialize any invites waiting on this email before listing.
  await acceptPendingInvites(c, user)

  const zone = hsDirectZone(c.env)
  const [links, defaultId] = await Promise.all([
    listLinksForUser(c.env, user.userId),
    getDefaultServer(c.env, user.userId),
  ])
  const out: LinkedServerDTO[] = links.map((l) => {
    // The hs.direct fallback host, when this server has an active cert. `url` is
    // the PREFERRED address (the user's own domain if they set one, else the
    // hs.direct URL stored as public_url). If the preferred URL is already the
    // hs.direct host, fallback equals it (harmless). The SPA tries url, then
    // fallback - hs.direct is the always-valid, monitored backup connection.
    const fallback = l.cert_hash ? `https://${l.cert_hash}.${zone}` : undefined
    return {
      id: l.server_id,
      name: l.display_name || l.server_name || l.public_url,
      url: l.public_url,
      ...(fallback ? { fallback_url: fallback } : {}),
      role: l.role,
      ...(l.server_id === defaultId ? { is_default: true } : {}),
    }
  })
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

/**
 * Reset (rotate) a server's server_secret in place - owner-admin only.
 *
 * Recovery hatch for a box that lost or desynced its stored secret (data-volume
 * loss, restore from an older backup, an interrupted re-pair). The normal path is
 * for the box to present its current secret at /pairing/start; when that secret is
 * gone, /pairing/start correctly refuses (server_id is public). This lets the
 * server's OWNER re-key from the hosted app without deregistering, so links,
 * invites, certs, and the default all survive.
 *
 * Mints a fresh secret, rotates ONLY the hash (not public_url/name), and returns
 * the plaintext ONCE - the operator pastes it into the box's "recover connection"
 * field. It is never stored or returned again. Audited.
 */
servers.post('/servers/:id/reset-secret', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  if (!user.emailVerified) return c.json({ error: 'email_unverified' }, 403)

  const serverId = c.req.param('id')
  const link = await getLink(c.env, user.userId, serverId)
  if (!link) return c.json({ error: 'not_linked' }, 404)
  if (link.role !== 'admin') return c.json({ error: 'forbidden', detail: 'admin only' }, 403)
  const server = await getServer(c.env, serverId)
  if (!server) return c.json({ error: 'server_unknown' }, 404)

  const secret = serverSecret()
  const secretHash = await sha256Hex(secret)
  await setServerSecretHash(c.env, serverId, secretHash)
  await writeAudit(c.env, {
    id: uuid(),
    actor: user.userId,
    action: 'reset_server_secret',
    target: serverId,
    detail: { email: link.email },
  })

  return c.json({ ok: true, server_id: serverId, server_secret: secret })
})

/**
 * Live reachability of one linked server, for the picker's status dot AND for
 * preferred-domain -> hs.direct failover. Probes the PREFERRED url first; if it's
 * offline and the server has an hs.direct cert, probes that fallback too and tells
 * the SPA which URL to actually connect to. Requires the caller to be linked.
 */
servers.get('/servers/:id/status', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const serverId = c.req.param('id')
  const link = await getLink(c.env, user.userId, serverId)
  if (!link) return c.json({ error: 'not_linked' }, 404)
  const server = await getServer(c.env, serverId)
  if (!server) return c.json({ error: 'server_unknown' }, 404)

  // The hs.direct fallback host, if this server has an active cert. Reachable even
  // when the user's own domain is down/misconfigured, because we control it.
  const cert = await getServerCert(c.env, serverId)
  const fallbackUrl =
    cert?.status === 'active' ? `https://${cert.hash}.${hsDirectZone(c.env)}` : null

  const preferredCheck = validatePublicUrl(server.public_url)
  // Probe the preferred URL when it's a valid browser origin.
  let preferred: { status: ProbeStatus; httpStatus?: number; detail?: string } | null = null
  if (preferredCheck.ok && preferredCheck.origin) {
    preferred = await probeServer(preferredCheck.origin)
  }

  // If preferred is online, we're done - use it.
  if (preferred?.status === 'online') {
    c.executionCtx?.waitUntil?.(touchServer(c.env, serverId).catch(() => {}))
    return c.json({
      status: 'online',
      reachable: true,
      connect_url: server.public_url,
      via: 'preferred',
      http_status: preferred.httpStatus,
    })
  }

  // Preferred is down (or not a valid origin). Try the hs.direct fallback.
  if (fallbackUrl && fallbackUrl !== server.public_url) {
    const fb = await probeServer(fallbackUrl)
    if (fb.status === 'online') {
      c.executionCtx?.waitUntil?.(touchServer(c.env, serverId).catch(() => {}))
      return c.json({
        status: 'online',
        reachable: true,
        connect_url: fallbackUrl,
        via: 'hsdirect_fallback',
        http_status: fb.httpStatus,
        preferred_detail: preferred?.detail ?? preferredCheck.reason ?? 'unreachable',
      })
    }
  }

  // Nothing reachable.
  return c.json({
    status: 'offline',
    reachable: false,
    connect_url: null,
    reason: preferred ? preferred.detail : preferredCheck.reason,
    fallback_tried: Boolean(fallbackUrl),
  })
})

servers.delete('/servers/:id', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const serverId = c.req.param('id')
  await deleteLink(c.env, user.userId, serverId)
  // Forgetting the default server clears the default so a fresh device falls
  // back to the picker rather than pointing at a server the user no longer has.
  await clearDefaultServerIf(c.env, user.userId, serverId)
  return c.json({ ok: true })
})

// Set this server as the user's default - the one a fresh device auto-connects
// to. Stored per MyHS user (not per device), so it follows the account.
servers.post('/servers/:id/default', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const serverId = c.req.param('id')
  // Only a server the user is actually linked to can be their default.
  const link = await getLink(c.env, user.userId, serverId)
  if (!link) return c.json({ error: 'not_linked' }, 404)
  await setDefaultServer(c.env, user.userId, serverId)
  return c.json({ ok: true })
})

// Clear the user's default (fresh devices go back to the picker).
servers.delete('/servers/:id/default', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const serverId = c.req.param('id')
  await clearDefaultServerIf(c.env, user.userId, serverId)
  return c.json({ ok: true })
})

const APP_ORIGIN = 'https://app.hearthshelf.com'

function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

/**
 * Invite someone by email to a server. Admin-only (the inviter must have an
 * admin link to the server). Mints a short invite code, emails it as a link, and
 * returns it so the admin can also read it out. Re-inviting refreshes the
 * existing row and mints a fresh code, retiring the old one.
 *
 * No Clerk invitation is involved: Clerk sign-up is open, so an invitation never
 * gated anything - this code is what grants library access.
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

  const token = inviteCode()
  await upsertInvite(c.env, {
    id: uuid(),
    email,
    serverId,
    role,
    invitedBy: user.userId,
    token,
  })

  // The invite email via Resend. A send failure no longer strands the invitee -
  // the admin can read them the code - so it's reported rather than fatal, and
  // the code comes back either way.
  let emailed = false
  try {
    const server = await getServer(c.env, serverId)
    // The code drives acceptance (relay-proof); server is kept only so the
    // landing page can show which library before the list loads.
    const { subject, html, text } = renderInviteEmail({
      serverName: server?.name ?? null,
      code: token,
      acceptUrl: `${APP_ORIGIN}/invite?token=${encodeURIComponent(token)}&server=${encodeURIComponent(serverId)}`,
    })
    await sendEmail(c.env, { to: email, subject, html, text })
    emailed = true
  } catch (err) {
    if (!(err instanceof EmailError)) throw err
    emailed = false
  }

  return c.json({ ok: true, email, role, code: token, emailed })
})

/** List pending invites for a server (admin-only). */
servers.get('/servers/:id/invites', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const serverId = c.req.param('id')
  const link = await getLink(c.env, user.userId, serverId)
  if (!link || link.role !== 'admin') return c.json({ error: 'forbidden' }, 403)
  const invites = await pendingInvitesForServer(c.env, serverId)
  // The code is shown to this server's own admins so they can read it out to an
  // invitee whose email never arrived - the same people who could re-invite anyway.
  return c.json({
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      code: i.token,
      created_at: i.created_at,
      expires_at: i.expires_at,
    })),
  })
})

/**
 * Cancel a pending invite (admin-only). The code stops working immediately.
 * Returns ok even if the invite was already gone so a double-click is harmless.
 */
servers.delete('/servers/:id/invites/:inviteId', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const serverId = c.req.param('id')
  const link = await getLink(c.env, user.userId, serverId)
  if (!link || link.role !== 'admin') return c.json({ error: 'forbidden' }, 403)
  await revokeInvite(c.env, serverId, c.req.param('inviteId'))
  return c.json({ ok: true })
})

/**
 * Cancel a pending invite, server-to-server (server_secret authed). The
 * self-hosted UI's counterpart to the admin endpoint above.
 */
servers.post('/servers/revoke-invite', async (c) => {
  let body: { server_id?: string; server_secret?: string; invite_id?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const serverId = (body.server_id || '').trim()
  const secret = body.server_secret || ''
  const inviteId = (body.invite_id || '').trim()
  if (!serverId || !secret) return c.json({ error: 'server_id and server_secret required' }, 400)
  if (!inviteId) return c.json({ error: 'invite_id required' }, 400)

  const server = await getServer(c.env, serverId)
  if (!server) return c.json({ error: 'server_unknown' }, 404)
  const presented = await sha256Hex(secret)
  if (!timingSafeEqual(presented, server.server_secret_hash)) {
    return c.json({ error: 'bad_server_secret' }, 401)
  }

  await revokeInvite(c.env, serverId, inviteId)
  return c.json({ ok: true })
})

/**
 * Update the server's display name (server-to-server, server_secret authed). The
 * box pushes this when the admin renames it in Server Settings, so the name shown
 * in the hosted app stays in sync rather than being frozen at pairing time.
 */
/**
 * Verify a server_secret without side effects (server-to-server). Lets a box
 * confirm a pasted "recover connection" secret is the live one BEFORE it
 * overwrites its stored copy, so a typo can't clobber a still-valid secret.
 * Returns { ok: true } on match, 401 bad_server_secret otherwise.
 */
servers.post('/servers/verify-secret', async (c) => {
  let body: { server_id?: string; server_secret?: string }
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
  return c.json({ ok: true })
})

/**
 * The box reports the versions it is running (server_secret authed). Stored next
 * to last_seen_at as operational bookkeeping; the SPA drives update prompts off
 * the box's live version vs. the releases cache, not off this. We return the
 * latest release so the box can log a one-line "update available" nudge to its
 * own console without a second call. Idempotent.
 */
servers.post('/servers/version', async (c) => {
  let body: { server_id?: string; server_secret?: string; hs_version?: string; abs_version?: string }
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

  const hsVersion = typeof body.hs_version === 'string' ? body.hs_version.slice(0, 40) : null
  const absVersion = typeof body.abs_version === 'string' ? body.abs_version.slice(0, 40) : null
  await setServerVersion(c.env, { serverId, hsVersion, absVersion })

  const latest = toDTO(await getLatestReleaseFresh(c.env))
  return c.json({ ok: true, latest })
})

servers.post('/servers/name', async (c) => {
  let body: { server_id?: string; server_secret?: string; name?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const serverId = (body.server_id || '').trim()
  const secret = body.server_secret || ''
  const name = (body.name || '').trim()
  if (!serverId || !secret) return c.json({ error: 'server_id and server_secret required' }, 400)
  if (name.length < 2) return c.json({ error: 'name_too_short' }, 400)

  const server = await getServer(c.env, serverId)
  if (!server) return c.json({ error: 'server_unknown' }, 404)
  const presented = await sha256Hex(secret)
  if (!timingSafeEqual(presented, server.server_secret_hash)) {
    return c.json({ error: 'bad_server_secret' }, 401)
  }

  await setServerName(c.env, serverId, name)
  return c.json({ ok: true, name })
})

/**
 * Re-push the server's public_url (server_secret authed). The box calls this when
 * its public IP changes (a connect-domain address embeds the IP), so the hosted
 * app reaches it at the new address AND - critically - the dedicated Clerk OAuth
 * client's single pinned redirect_uri is re-PATCHed to the new reachable callback,
 * keeping OIDC sign-in working across IP changes. Best-effort on the Clerk side;
 * the public_url is always recorded. Idempotent (no-op if unchanged).
 */
servers.post('/servers/public-url', async (c) => {
  let body: { server_id?: string; server_secret?: string; public_url?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const serverId = (body.server_id || '').trim()
  const secret = body.server_secret || ''
  const publicUrl = (body.public_url || '').trim()
  if (!serverId || !secret || !publicUrl) {
    return c.json({ error: 'server_id, server_secret and public_url required' }, 400)
  }
  const check = validatePublicUrl(publicUrl)
  if (!check.ok) return c.json({ error: 'public_url_invalid', reason: check.reason }, 400)

  const server = await getServer(c.env, serverId)
  if (!server) return c.json({ error: 'server_unknown' }, 404)
  const presented = await sha256Hex(secret)
  if (!timingSafeEqual(presented, server.server_secret_hash)) {
    return c.json({ error: 'bad_server_secret' }, 401)
  }

  const origin = check.origin as string
  await updateServerPublicUrl(c.env, serverId, origin)
  // No OIDC client to re-pin under HS-owned auth - recording the address is enough
  // (it's what the SPA reaches + what grants are minted for).
  return c.json({ ok: true, public_url: origin })
})

/**
 * Box-initiated disconnect (server_secret authed). The self-hosted box tears down
 * its own registration: revoke the dedicated Clerk OAuth client, then delete the
 * server row (links / invites / oauth / certs cascade). After this the server is
 * fully gone from the hosted app - it no longer appears in anyone's list. The box
 * also clears its local trust state. Idempotent: an unknown server returns ok.
 */
servers.post('/servers/deregister', async (c) => {
  let body: { server_id?: string; server_secret?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const serverId = (body.server_id || '').trim()
  const secret = body.server_secret || ''
  if (!serverId || !secret) return c.json({ error: 'server_id and server_secret required' }, 400)

  const server = await getServer(c.env, serverId)
  if (!server) return c.json({ ok: true }) // already gone - idempotent
  const presented = await sha256Hex(secret)
  if (!timingSafeEqual(presented, server.server_secret_hash)) {
    return c.json({ error: 'bad_server_secret' }, 401)
  }

  // Delete the server row - dependents cascade. (No Clerk OAuth client to revoke
  // under HS-owned auth.)
  await deleteServer(c.env, serverId)
  return c.json({ ok: true })
})

/**
 * Server-initiated invite. A paired HS server (whose own admin authorized this)
 * invites someone, authenticating with its server_secret rather than a Clerk
 * token. Same outcome as the user-facing invite. Lets admins invite from inside
 * their self-hosted HS UI.
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

  const token = inviteCode()
  await upsertInvite(c.env, {
    id: uuid(),
    email,
    serverId,
    role,
    invitedBy: 'server',
    token,
  })

  // Report send failure rather than failing the call: the code comes back either
  // way, so the admin can read it out if the email never lands.
  let emailed = false
  try {
    const { subject, html, text } = renderInviteEmail({
      serverName: server.name ?? null,
      code: token,
      acceptUrl: `${APP_ORIGIN}/invite?token=${encodeURIComponent(token)}&server=${encodeURIComponent(serverId)}`,
    })
    await sendEmail(c.env, { to: email, subject, html, text })
    emailed = true
  } catch (err) {
    if (!(err instanceof EmailError)) throw err
    emailed = false
  }

  return c.json({ ok: true, email, role, code: token, emailed })
})

/**
 * List pending invites for a server, server-to-server (server_secret authed).
 * Lets the self-hosted HS UI show its own pending invites without a Clerk
 * session - same trust model as invite-from-server.
 */
servers.post('/servers/invites-for-server', async (c) => {
  let body: { server_id?: string; server_secret?: string }
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

  const invites = await pendingInvitesForServer(c.env, serverId)
  // The code is shown to this server's own admins so they can read it out to an
  // invitee whose email never arrived - the same people who could re-invite anyway.
  return c.json({
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      code: i.token,
      created_at: i.created_at,
      expires_at: i.expires_at,
    })),
  })
})

/**
 * hs.direct cert-broker grant (server-to-server). A paired HS box, about to
 * obtain or renew its hs.direct wildcard cert, asks the control plane to
 * authorize the request. We authenticate with the server_secret (same pattern as
 * the other server-to-server endpoints), mint a short-TTL EdDSA grant scoped to
 * this server's `<hash>`, and return it along with the broker URL + the stable
 * host. The HS box then POSTs its CSR + this grant to the VPS broker, which
 * verifies the grant against our JWKS and runs ACME. The control plane never
 * runs ACME and never sees a private key. See docs/hs-direct-implementation.md
 * sec 1.2.
 */
servers.post('/servers/cert-grant', async (c) => {
  let body: { server_id?: string; server_secret?: string }
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

  if (!c.env.HSDIRECT_BROKER_URL) {
    return c.json({ error: 'hsdirect_not_configured', detail: 'broker URL unset' }, 501)
  }

  const { token, hash, host } = await mintCertGrant(c.env, { serverId })
  await upsertServerCertPending(c.env, { serverId, hash })

  return c.json({
    cert_grant: token,
    broker_url: c.env.HSDIRECT_BROKER_URL,
    hash,
    host, // stable <hash>.<zone>; cert wildcard is *.<hash>.<zone>
    zone: host.slice(hash.length + 1), // the <zone> portion, for the box to compose names
    expires_in: Number(c.env.CERT_GRANT_TTL_SECONDS || '300'),
  })
})

/**
 * The HS box reports the outcome of an issue/renew so the picker/admin UI can
 * reflect real cert status. Server-secret authenticated. Pure bookkeeping - it
 * does not gate anything (the cert already lives on the box either way).
 */
servers.post('/servers/cert-status', async (c) => {
  let body: {
    server_id?: string
    server_secret?: string
    status?: string
    acme_env?: string
    not_after?: number
    error?: string
  }
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

  const status = body.status === 'active' ? 'active' : body.status === 'failed' ? 'failed' : null
  if (!status) return c.json({ error: 'status must be active|failed' }, 400)

  await recordServerCertResult(c.env, {
    serverId,
    status,
    acmeEnv: body.acme_env ?? null,
    notAfter: typeof body.not_after === 'number' ? body.not_after : null,
    lastError: typeof body.error === 'string' ? body.error.slice(0, 500) : null,
  })
  const cert = await getServerCert(c.env, serverId)
  return c.json({ ok: true, status: cert?.status })
})

// Documented stub for the advertised grant_url. The shipping design mints
// grants via the user-authenticated /servers/:id/grant above and the client
// carries the grant to HS - the control plane is never in the data path. This
// endpoint exists so the URL we hand HS at pairing time returns a clear 501
// rather than a 404 if anything calls it.
servers.post('/servers/grant', (c) =>
  c.json(
    { error: 'not_implemented', detail: 'use POST /servers/:id/grant (user-authenticated)' },
    501,
  ),
)
