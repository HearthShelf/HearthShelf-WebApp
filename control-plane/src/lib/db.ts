/**
 * Thin typed accessors over D1. Keeps SQL in one place so route handlers read
 * as intent, not query strings.
 */
import type { Env } from '../types'
import { now } from './ids'

export interface ServerRow {
  server_id: string
  public_url: string
  name: string | null
  server_secret_hash: string
  created_at: number
  last_seen_at: number | null
}

export interface LinkRow {
  id: string
  clerk_user_id: string
  server_id: string
  email: string
  role: 'admin' | 'user'
  display_name: string | null
  created_at: number
}

export interface PairingRow {
  code: string
  server_id: string
  public_url: string
  name: string | null
  server_secret_hash: string
  created_at: number
  expires_at: number
  redeemed_at: number | null
  redeemed_by: string | null
}

// --- servers ---------------------------------------------------------------

export async function upsertServer(
  env: Env,
  s: { serverId: string; publicUrl: string; name: string | null; secretHash: string }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO servers (server_id, public_url, name, server_secret_hash, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (server_id) DO UPDATE SET
       public_url = excluded.public_url,
       name = excluded.name,
       server_secret_hash = excluded.server_secret_hash,
       last_seen_at = excluded.last_seen_at`
  )
    .bind(s.serverId, s.publicUrl, s.name, s.secretHash, now(), now())
    .run()
}

export async function getServer(env: Env, serverId: string): Promise<ServerRow | null> {
  return env.DB.prepare(`SELECT * FROM servers WHERE server_id = ?`)
    .bind(serverId)
    .first<ServerRow>()
}

export async function touchServer(env: Env, serverId: string): Promise<void> {
  await env.DB.prepare(`UPDATE servers SET last_seen_at = ? WHERE server_id = ?`)
    .bind(now(), serverId)
    .run()
}

// Update a server's display name after pairing (the box pushes this when the
// admin renames it in Server Settings). No-op if the server row doesn't exist.
export async function setServerName(
  env: Env,
  serverId: string,
  name: string
): Promise<void> {
  await env.DB.prepare(`UPDATE servers SET name = ?, last_seen_at = ? WHERE server_id = ?`)
    .bind(name, now(), serverId)
    .run()
}

// Remove a server entirely (box-initiated disconnect). All dependents - links,
// invites, server_certs - cascade via their ON DELETE CASCADE FKs, so the server
// fully vanishes from the hosted app. No-op if absent.
export async function deleteServer(env: Env, serverId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM servers WHERE server_id = ?`).bind(serverId).run()
}

// Update a server's public_url after the box provisions its real connect-domain
// address (paired with /pairing/update-url, which updates the pairing row). The
// servers row exists from /pairing/start now, so keep its URL current too - the
// grant/status routes read server.public_url.
export async function updateServerPublicUrl(
  env: Env,
  serverId: string,
  publicUrl: string
): Promise<void> {
  await env.DB.prepare(`UPDATE servers SET public_url = ?, last_seen_at = ? WHERE server_id = ?`)
    .bind(publicUrl, now(), serverId)
    .run()
}

// Sweep abandoned server registrations. Since /pairing/start now creates the
// servers row up front (so cert-grant works pre-redeem), a box that starts but is
// never redeemed leaves an inert row. Delete rows older than the TTL that have NO
// owner link AND no live (unredeemed, unexpired) pairing code. Dependents cascade.
// Fire-and-forget from /pairing/start; never blocks pairing.
export async function sweepOrphanServers(env: Env): Promise<void> {
  const ttlMs = Number(env.ORPHAN_TTL_SECONDS || '604800') * 1000 // default 7d
  const cutoff = now() - ttlMs
  const t = now()
  await env.DB.prepare(
    `DELETE FROM servers
       WHERE created_at < ?
         AND server_id NOT IN (SELECT server_id FROM links)
         AND server_id NOT IN (
           SELECT server_id FROM pairing_codes
            WHERE redeemed_at IS NULL AND expires_at > ?
         )`
  )
    .bind(cutoff, t)
    .run()
}

// --- links -----------------------------------------------------------------

export async function listLinksForUser(env: Env, clerkUserId: string): Promise<
  Array<LinkRow & { public_url: string; server_name: string | null; cert_hash: string | null }>
> {
  // LEFT JOIN server_certs so we know each server's hs.direct hash (when it has
  // provisioned one), to expose the fallback URL alongside the preferred one.
  const r = await env.DB.prepare(
    `SELECT l.*, s.public_url, s.name AS server_name, c.hash AS cert_hash
       FROM links l
       JOIN servers s ON s.server_id = l.server_id
       LEFT JOIN server_certs c ON c.server_id = l.server_id AND c.status = 'active'
      WHERE l.clerk_user_id = ?
      ORDER BY l.created_at ASC`
  )
    .bind(clerkUserId)
    .all<LinkRow & { public_url: string; server_name: string | null; cert_hash: string | null }>()
  return r.results ?? []
}

export async function getLink(
  env: Env,
  clerkUserId: string,
  serverId: string
): Promise<LinkRow | null> {
  return env.DB.prepare(`SELECT * FROM links WHERE clerk_user_id = ? AND server_id = ?`)
    .bind(clerkUserId, serverId)
    .first<LinkRow>()
}

export async function createLink(
  env: Env,
  l: {
    id: string
    clerkUserId: string
    serverId: string
    email: string
    role: 'admin' | 'user'
    displayName: string | null
  }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO links (id, clerk_user_id, server_id, email, role, display_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (clerk_user_id, server_id) DO UPDATE SET
       email = excluded.email, role = excluded.role, display_name = excluded.display_name`
  )
    .bind(l.id, l.clerkUserId, l.serverId, l.email, l.role, l.displayName, now())
    .run()
}

export async function deleteLink(env: Env, clerkUserId: string, serverId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM links WHERE clerk_user_id = ? AND server_id = ?`)
    .bind(clerkUserId, serverId)
    .run()
}

/** How many users are still linked to a server (to decide last-one-out cleanup). */
export async function countLinksForServer(env: Env, serverId: string): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM links WHERE server_id = ?`)
    .bind(serverId)
    .first<{ n: number }>()
  return r?.n ?? 0
}

// The first (owner/admin) link for a server, used by /pairing/status to tell the
// box who claimed it. Earliest-created link = the admin who redeemed first.
export async function getOwnerLinkForServer(
  env: Env,
  serverId: string
): Promise<{ email: string; role: string } | null> {
  return env.DB.prepare(
    `SELECT email, role FROM links WHERE server_id = ? ORDER BY created_at ASC LIMIT 1`
  )
    .bind(serverId)
    .first<{ email: string; role: string }>()
}

// --- hs.direct cert status -------------------------------------------------

export interface ServerCertRow {
  server_id: string
  hash: string
  status: 'pending' | 'active' | 'failed'
  acme_env: string | null
  last_issued_at: number | null
  not_after: number | null
  last_error: string | null
  created_at: number
  updated_at: number
}

/** Record (or refresh) that a cert grant was minted for a server. */
export async function upsertServerCertPending(
  env: Env,
  c: { serverId: string; hash: string }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO server_certs (server_id, hash, status, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?)
     ON CONFLICT (server_id) DO UPDATE SET
       hash = excluded.hash,
       updated_at = excluded.updated_at`
  )
    .bind(c.serverId, c.hash, now(), now())
    .run()
}

/** The server reports the outcome of an issue/renew (active or failed). */
export async function recordServerCertResult(
  env: Env,
  c: {
    serverId: string
    status: 'active' | 'failed'
    acmeEnv?: string | null
    notAfter?: number | null
    lastError?: string | null
  }
): Promise<void> {
  await env.DB.prepare(
    `UPDATE server_certs SET
       status = ?,
       acme_env = COALESCE(?, acme_env),
       last_issued_at = CASE WHEN ? = 'active' THEN ? ELSE last_issued_at END,
       not_after = COALESCE(?, not_after),
       last_error = ?,
       updated_at = ?
     WHERE server_id = ?`
  )
    .bind(
      c.status,
      c.acmeEnv ?? null,
      c.status,
      now(),
      c.notAfter ?? null,
      // Keep whatever note was provided (active reports may carry a diagnostic
      // string); only clear it when an active report sends no note at all.
      c.lastError ?? null,
      now(),
      c.serverId
    )
    .run()
}

export async function getServerCert(env: Env, serverId: string): Promise<ServerCertRow | null> {
  return env.DB.prepare(`SELECT * FROM server_certs WHERE server_id = ?`)
    .bind(serverId)
    .first<ServerCertRow>()
}

// --- pairing codes ---------------------------------------------------------

export async function createPairing(
  env: Env,
  p: {
    code: string
    serverId: string
    publicUrl: string
    name: string | null
    secretHash: string
    expiresAt: number
  }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO pairing_codes
       (code, server_id, public_url, name, server_secret_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(p.code, p.serverId, p.publicUrl, p.name, p.secretHash, now(), p.expiresAt)
    .run()
}

export async function getPairing(env: Env, code: string): Promise<PairingRow | null> {
  return env.DB.prepare(`SELECT * FROM pairing_codes WHERE code = ?`)
    .bind(code)
    .first<PairingRow>()
}

export async function markPairingRedeemed(
  env: Env,
  code: string,
  clerkUserId: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE pairing_codes SET redeemed_at = ?, redeemed_by = ? WHERE code = ?`
  )
    .bind(now(), clerkUserId, code)
    .run()
}

// Update a pairing's public_url before it is redeemed. Used by the HS box to swap
// the placeholder it sent at /pairing/start for its real hs.direct hostname once
// the cert is provisioned, so /pairing/redeem validates the reachable address.
export async function updatePairingPublicUrl(
  env: Env,
  code: string,
  publicUrl: string
): Promise<void> {
  await env.DB.prepare(`UPDATE pairing_codes SET public_url = ? WHERE code = ?`)
    .bind(publicUrl, code)
    .run()
}

// --- pending invites -------------------------------------------------------

export interface InviteRow {
  id: string
  email: string
  server_id: string
  role: 'admin' | 'user'
  invited_by: string | null
  clerk_invitation_id: string | null
  status: 'pending' | 'accepted' | 'revoked'
  created_at: number
  accepted_at: number | null
}

export async function upsertInvite(
  env: Env,
  inv: {
    id: string
    email: string
    serverId: string
    role: 'admin' | 'user'
    invitedBy: string | null
    clerkInvitationId: string | null
  }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO pending_invites
       (id, email, server_id, role, invited_by, clerk_invitation_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
     ON CONFLICT (email, server_id) DO UPDATE SET
       role = excluded.role,
       invited_by = excluded.invited_by,
       clerk_invitation_id = excluded.clerk_invitation_id,
       status = 'pending',
       created_at = excluded.created_at,
       accepted_at = NULL`
  )
    .bind(inv.id, inv.email, inv.serverId, inv.role, inv.invitedBy, inv.clerkInvitationId, now())
    .run()
}

/** All pending invites for a (verified) email, with server details. */
export async function pendingInvitesForEmail(
  env: Env,
  email: string
): Promise<Array<InviteRow & { public_url: string; server_name: string | null }>> {
  const r = await env.DB.prepare(
    `SELECT i.*, s.public_url, s.name AS server_name
       FROM pending_invites i JOIN servers s ON s.server_id = i.server_id
      WHERE i.email = ? AND i.status = 'pending'`
  )
    .bind(email.toLowerCase())
    .all<InviteRow & { public_url: string; server_name: string | null }>()
  return r.results ?? []
}

export async function markInviteAccepted(env: Env, id: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE pending_invites SET status = 'accepted', accepted_at = ? WHERE id = ?`
  )
    .bind(now(), id)
    .run()
}

/** Pending invites an admin can see for a server they manage. */
export async function pendingInvitesForServer(env: Env, serverId: string): Promise<InviteRow[]> {
  const r = await env.DB.prepare(
    `SELECT * FROM pending_invites WHERE server_id = ? AND status = 'pending' ORDER BY created_at DESC`
  )
    .bind(serverId)
    .all<InviteRow>()
  return r.results ?? []
}

// --- email send metering ---------------------------------------------------

/** Start of the current UTC calendar month, as a millisecond epoch. The bucket
 *  key for monthly send quotas; a new month is simply a new row. */
export function monthWindowStart(): number {
  const d = new Date(now())
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

/** How many emails a server has sent in the current monthly window. */
export async function emailSentThisWindow(env: Env, serverId: string): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT sent FROM email_quota WHERE server_id = ? AND window_start = ?`
  )
    .bind(serverId, monthWindowStart())
    .first<{ sent: number }>()
  return r?.sent ?? 0
}

/** Increment a server's send count for the current window (creating the row). */
export async function incrementEmailSent(env: Env, serverId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO email_quota (server_id, window_start, sent, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT (server_id, window_start) DO UPDATE SET
       sent = sent + 1,
       updated_at = excluded.updated_at`
  )
    .bind(serverId, monthWindowStart(), now())
    .run()
}

// --- platform admins -------------------------------------------------------

export interface PlatformAdminRow {
  clerk_user_id: string
  role: string
  email: string | null
  granted_by: string | null
  granted_at: number
}

/** Resolve a platform-admin row by clerk_user_id OR (lowercased) email. Email
 *  match supports the seed/log-viewer cutover where a row may exist by email
 *  before we've seen the operator's Clerk id. Returns null if neither matches. */
export async function getPlatformAdmin(
  env: Env,
  opts: { clerkUserId?: string; email?: string }
): Promise<PlatformAdminRow | null> {
  const id = opts.clerkUserId ?? ''
  const email = (opts.email ?? '').toLowerCase()
  if (!id && !email) return null
  return env.DB.prepare(
    `SELECT * FROM platform_admins WHERE clerk_user_id = ? OR (email IS NOT NULL AND email = ?) LIMIT 1`
  )
    .bind(id, email)
    .first<PlatformAdminRow>()
}

/** Backfill the real Clerk id onto an email-seeded admin row, the first time that
 *  operator authenticates. Rewrites the PK from the 'seed:<email>' placeholder to
 *  the actual clerk_user_id so the row is id-authoritative thereafter. No-op if
 *  the row already keys on this id. */
export async function backfillAdminClerkId(
  env: Env,
  email: string,
  clerkUserId: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE platform_admins SET clerk_user_id = ?
       WHERE email = ? AND clerk_user_id <> ?`
  )
    .bind(clerkUserId, email.toLowerCase(), clerkUserId)
    .run()
}

export async function listPlatformAdmins(env: Env): Promise<PlatformAdminRow[]> {
  const r = await env.DB.prepare(
    `SELECT * FROM platform_admins ORDER BY granted_at ASC`
  ).all<PlatformAdminRow>()
  return r.results ?? []
}

export async function addPlatformAdmin(
  env: Env,
  a: { clerkUserId: string; email: string | null; role?: string; grantedBy: string }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO platform_admins (clerk_user_id, role, email, granted_by, granted_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       role = excluded.role, email = excluded.email`
  )
    .bind(a.clerkUserId, a.role ?? 'admin', a.email?.toLowerCase() ?? null, a.grantedBy, now())
    .run()
}

export async function removePlatformAdmin(env: Env, clerkUserId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM platform_admins WHERE clerk_user_id = ?`)
    .bind(clerkUserId)
    .run()
}

/** Count remaining admins - used to refuse removing the last one (lockout guard). */
export async function countPlatformAdmins(env: Env): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM platform_admins`).first<{ n: number }>()
  return r?.n ?? 0
}

// --- admin audit -----------------------------------------------------------

export interface AuditRow {
  id: string
  actor: string
  action: string
  target: string | null
  detail: string | null
  created_at: number
}

export async function writeAudit(
  env: Env,
  a: { id: string; actor: string; action: string; target?: string | null; detail?: unknown }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO admin_audit (id, actor, action, target, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      a.id,
      a.actor,
      a.action,
      a.target ?? null,
      a.detail === undefined ? null : JSON.stringify(a.detail),
      now()
    )
    .run()
}

export async function listAudit(env: Env, limit = 100): Promise<AuditRow[]> {
  const capped = Math.min(Math.max(limit, 1), 500)
  const r = await env.DB.prepare(
    `SELECT * FROM admin_audit ORDER BY created_at DESC LIMIT ?`
  )
    .bind(capped)
    .all<AuditRow>()
  return r.results ?? []
}

// --- entitlements (billing seam) -------------------------------------------

export interface EntitlementRow {
  clerk_user_id: string
  plan: string
  source: string
  granted_by: string | null
  updated_at: number
}

/** The user's plan. D1 is the SOLE source of truth - never read from a JWT.
 *  Absent row = 'free'. */
export async function getEntitlement(env: Env, clerkUserId: string): Promise<EntitlementRow | null> {
  return env.DB.prepare(`SELECT * FROM entitlements WHERE clerk_user_id = ?`)
    .bind(clerkUserId)
    .first<EntitlementRow>()
}

export async function setEntitlement(
  env: Env,
  e: { clerkUserId: string; plan: string; source?: string; grantedBy: string }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO entitlements (clerk_user_id, plan, source, granted_by, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       plan = excluded.plan, source = excluded.source,
       granted_by = excluded.granted_by, updated_at = excluded.updated_at`
  )
    .bind(e.clerkUserId, e.plan, e.source ?? 'manual', e.grantedBy, now())
    .run()
}

/** Listing of all servers for the admin moderation view, with linked-user counts. */
export async function listAllServers(env: Env): Promise<
  Array<ServerRow & { link_count: number }>
> {
  const r = await env.DB.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM links l WHERE l.server_id = s.server_id) AS link_count
       FROM servers s
      ORDER BY s.created_at DESC`
  ).all<ServerRow & { link_count: number }>()
  return r.results ?? []
}

/** All links for a server (admin inspect view). */
export async function listLinksForServer(env: Env, serverId: string): Promise<LinkRow[]> {
  const r = await env.DB.prepare(
    `SELECT * FROM links WHERE server_id = ? ORDER BY created_at ASC`
  )
    .bind(serverId)
    .all<LinkRow>()
  return r.results ?? []
}

/** All links for a user across servers (admin user-inspect view). */
export async function listLinksByUser(env: Env, clerkUserId: string): Promise<LinkRow[]> {
  const r = await env.DB.prepare(
    `SELECT * FROM links WHERE clerk_user_id = ? ORDER BY created_at ASC`
  )
    .bind(clerkUserId)
    .all<LinkRow>()
  return r.results ?? []
}

// --- device handles (account switcher) -------------------------------------

export interface DeviceHandleRow {
  handle: string
  clerk_user_id: string
  label: string | null
  image_url: string | null
  pin_hash: string | null
  pin_salt: string | null
  pin_attempts: number
  created_at: number
  last_used_at: number | null
  expires_at: number
}

export async function createDeviceHandle(
  env: Env,
  h: {
    handle: string
    clerkUserId: string
    label?: string | null
    imageUrl?: string | null
    pinHash?: string | null
    pinSalt?: string | null
    expiresAt: number
  }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO device_handles
       (handle, clerk_user_id, label, image_url, pin_hash, pin_salt, created_at, last_used_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  )
    .bind(
      h.handle,
      h.clerkUserId,
      h.label ?? null,
      h.imageUrl ?? null,
      h.pinHash ?? null,
      h.pinSalt ?? null,
      now(),
      h.expiresAt
    )
    .run()
}

/** Look up a handle. Returns null if absent OR expired (an expired handle is
 *  swept as a side effect so the table doesn't accumulate dead rows). */
export async function getDeviceHandle(env: Env, handle: string): Promise<DeviceHandleRow | null> {
  const row = await env.DB.prepare(`SELECT * FROM device_handles WHERE handle = ?`)
    .bind(handle)
    .first<DeviceHandleRow>()
  if (!row) return null
  if (row.expires_at <= now()) {
    await deleteDeviceHandle(env, handle)
    return null
  }
  return row
}

export async function touchDeviceHandle(env: Env, handle: string): Promise<void> {
  await env.DB.prepare(`UPDATE device_handles SET last_used_at = ? WHERE handle = ?`)
    .bind(now(), handle)
    .run()
}

/** Bump the wrong-PIN counter and return the new value. */
export async function bumpPinAttempts(env: Env, handle: string): Promise<number> {
  const row = await env.DB.prepare(
    `UPDATE device_handles SET pin_attempts = pin_attempts + 1 WHERE handle = ?
     RETURNING pin_attempts`
  )
    .bind(handle)
    .first<{ pin_attempts: number }>()
  return row?.pin_attempts ?? 0
}

/** Reset the wrong-PIN counter after a correct PIN. */
export async function resetPinAttempts(env: Env, handle: string): Promise<void> {
  await env.DB.prepare(`UPDATE device_handles SET pin_attempts = 0 WHERE handle = ?`)
    .bind(handle)
    .run()
}

export async function deleteDeviceHandle(env: Env, handle: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM device_handles WHERE handle = ?`).bind(handle).run()
}

/** Every remembered account for a user (used to forget-everywhere on full logout). */
export async function listDeviceHandlesForUser(
  env: Env,
  clerkUserId: string
): Promise<DeviceHandleRow[]> {
  const r = await env.DB.prepare(
    `SELECT * FROM device_handles WHERE clerk_user_id = ? ORDER BY created_at ASC`
  )
    .bind(clerkUserId)
    .all<DeviceHandleRow>()
  return r.results ?? []
}
