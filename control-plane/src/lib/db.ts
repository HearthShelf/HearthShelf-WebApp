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
  hs_version: string | null
  abs_version: string | null
  version_reported_at: number | null
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
  s: { serverId: string; publicUrl: string; name: string | null; secretHash: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO servers (server_id, public_url, name, server_secret_hash, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (server_id) DO UPDATE SET
       public_url = excluded.public_url,
       name = excluded.name,
       server_secret_hash = excluded.server_secret_hash,
       last_seen_at = excluded.last_seen_at`,
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
export async function setServerName(env: Env, serverId: string, name: string): Promise<void> {
  await env.DB.prepare(`UPDATE servers SET name = ?, last_seen_at = ? WHERE server_id = ?`)
    .bind(name, now(), serverId)
    .run()
}

// Record the version a paired box reports (server-to-server). Bumps last_seen_at
// too - a paired box that isn't on hs.direct otherwise never refreshes it. Purely
// operational bookkeeping; not exposed as a per-box surveillance surface. No-op if
// the server row is absent.
export async function setServerVersion(
  env: Env,
  v: { serverId: string; hsVersion: string | null; absVersion: string | null },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE servers
       SET hs_version = ?, abs_version = ?, version_reported_at = ?, last_seen_at = ?
     WHERE server_id = ?`,
  )
    .bind(v.hsVersion, v.absVersion, now(), now(), v.serverId)
    .run()
}

// Rotate ONLY a server's secret hash, leaving public_url/name/links/certs intact.
// Backs the owner-authenticated in-place secret reset (recover a box that lost or
// desynced its stored server_secret without deregistering + re-pairing). Distinct
// from upsertServer, which also rewrites public_url/name. No-op if absent.
export async function setServerSecretHash(
  env: Env,
  serverId: string,
  secretHash: string,
): Promise<void> {
  await env.DB.prepare(`UPDATE servers SET server_secret_hash = ? WHERE server_id = ?`)
    .bind(secretHash, serverId)
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
  publicUrl: string,
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
         )`,
  )
    .bind(cutoff, t)
    .run()
}

// --- links -----------------------------------------------------------------

export async function listLinksForUser(
  env: Env,
  clerkUserId: string,
): Promise<
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
      ORDER BY l.created_at ASC`,
  )
    .bind(clerkUserId)
    .all<LinkRow & { public_url: string; server_name: string | null; cert_hash: string | null }>()
  return r.results ?? []
}

export async function getLink(
  env: Env,
  clerkUserId: string,
  serverId: string,
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
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO links (id, clerk_user_id, server_id, email, role, display_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (clerk_user_id, server_id) DO UPDATE SET
       email = excluded.email, role = excluded.role, display_name = excluded.display_name`,
  )
    .bind(l.id, l.clerkUserId, l.serverId, l.email, l.role, l.displayName, now())
    .run()
}

export async function deleteLink(env: Env, clerkUserId: string, serverId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM links WHERE clerk_user_id = ? AND server_id = ?`)
    .bind(clerkUserId, serverId)
    .run()
}

/** Forget every server link for a user (account data-deletion flow). */
export async function deleteAllLinksForUser(env: Env, clerkUserId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM links WHERE clerk_user_id = ?`).bind(clerkUserId).run()
}

/**
 * Drop every link between an email and one server, whoever holds it.
 *
 * Keyed by email rather than clerk_user_id because the server calling this
 * knows its ABS user's email, not their Clerk id - and a user removed before
 * they ever signed in hosted-side has a link but no local subject mapping.
 * Returns the number of links removed so the caller can report it.
 */
export async function deleteLinksForEmail(
  env: Env,
  serverId: string,
  email: string,
): Promise<number> {
  const r = await env.DB.prepare(`DELETE FROM links WHERE server_id = ? AND email = ?`)
    .bind(serverId, email.toLowerCase())
    .run()
  return r.meta?.changes ?? 0
}

/**
 * Revoke every still-pending invite for an email on one server. Paired with
 * deleteLinksForEmail: removing someone must not leave a live code behind that
 * silently re-admits them. Returns the number revoked.
 */
export async function revokeInvitesForEmail(
  env: Env,
  serverId: string,
  email: string,
): Promise<number> {
  const r = await env.DB.prepare(
    `UPDATE pending_invites SET status = 'revoked'
      WHERE server_id = ? AND email = ? AND status = 'pending'`,
  )
    .bind(serverId, email.toLowerCase())
    .run()
  return r.meta?.changes ?? 0
}

// --- user prefs (MyHS account-level) ---------------------------------------

/** The user's default server_id, or null when unset. Reads the one-row-per-user
 *  prefs table; a fresh device with no default shows the picker. */
export async function getDefaultServer(env: Env, clerkUserId: string): Promise<string | null> {
  const r = await env.DB.prepare(`SELECT default_server_id FROM user_prefs WHERE clerk_user_id = ?`)
    .bind(clerkUserId)
    .first<{ default_server_id: string | null }>()
  return r?.default_server_id ?? null
}

/** Set (or with null, clear) the user's default server. One scalar per user, so
 *  there's no cross-row invariant to maintain - the previous default is simply
 *  overwritten. */
export async function setDefaultServer(
  env: Env,
  clerkUserId: string,
  serverId: string | null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_prefs (clerk_user_id, default_server_id, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       default_server_id = excluded.default_server_id, updated_at = excluded.updated_at`,
  )
    .bind(clerkUserId, serverId, now())
    .run()
}

/** Clear the default only if it currently points at serverId. Called when a link
 *  is forgotten so a dangling default doesn't linger, without disturbing a
 *  default that points elsewhere. */
export async function clearDefaultServerIf(
  env: Env,
  clerkUserId: string,
  serverId: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE user_prefs SET default_server_id = NULL, updated_at = ?
       WHERE clerk_user_id = ? AND default_server_id = ?`,
  )
    .bind(now(), clerkUserId, serverId)
    .run()
}

/** Remove a user's prefs row entirely (account data-deletion flow). */
export async function deleteUserPrefs(env: Env, clerkUserId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM user_prefs WHERE clerk_user_id = ?`).bind(clerkUserId).run()
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
  serverId: string,
): Promise<{ email: string; role: string } | null> {
  return env.DB.prepare(
    `SELECT email, role FROM links WHERE server_id = ? ORDER BY created_at ASC LIMIT 1`,
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
  c: { serverId: string; hash: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO server_certs (server_id, hash, status, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?)
     ON CONFLICT (server_id) DO UPDATE SET
       hash = excluded.hash,
       updated_at = excluded.updated_at`,
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
  },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE server_certs SET
       status = ?,
       acme_env = COALESCE(?, acme_env),
       last_issued_at = CASE WHEN ? = 'active' THEN ? ELSE last_issued_at END,
       not_after = COALESCE(?, not_after),
       last_error = ?,
       updated_at = ?
     WHERE server_id = ?`,
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
      c.serverId,
    )
    .run()
}

export async function getServerCert(env: Env, serverId: string): Promise<ServerCertRow | null> {
  return env.DB.prepare(`SELECT * FROM server_certs WHERE server_id = ?`)
    .bind(serverId)
    .first<ServerCertRow>()
}

/** All cert rows, keyed by server_id - for the fleet roster list (avoids N+1). */
export async function listAllServerCerts(env: Env): Promise<Map<string, ServerCertRow>> {
  const r = await env.DB.prepare(`SELECT * FROM server_certs`).all<ServerCertRow>()
  return new Map((r.results ?? []).map((row) => [row.server_id, row]))
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
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO pairing_codes
       (code, server_id, public_url, name, server_secret_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(p.code, p.serverId, p.publicUrl, p.name, p.secretHash, now(), p.expiresAt)
    .run()
}

export async function getPairing(env: Env, code: string): Promise<PairingRow | null> {
  return env.DB.prepare(`SELECT * FROM pairing_codes WHERE code = ?`).bind(code).first<PairingRow>()
}

export async function markPairingRedeemed(
  env: Env,
  code: string,
  clerkUserId: string,
): Promise<void> {
  await env.DB.prepare(`UPDATE pairing_codes SET redeemed_at = ?, redeemed_by = ? WHERE code = ?`)
    .bind(now(), clerkUserId, code)
    .run()
}

// Update a pairing's public_url before it is redeemed. Used by the HS box to swap
// the placeholder it sent at /pairing/start for its real hs.direct hostname once
// the cert is provisioned, so /pairing/redeem validates the reachable address.
export async function updatePairingPublicUrl(
  env: Env,
  code: string,
  publicUrl: string,
): Promise<void> {
  await env.DB.prepare(`UPDATE pairing_codes SET public_url = ? WHERE code = ?`)
    .bind(publicUrl, code)
    .run()
}

// --- pending invites -------------------------------------------------------

/** How long an invite code stays redeemable. Short-lived on purpose: the code is
 *  only ~40 bits, so a bounded window is part of what keeps it safe. */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000

export interface InviteRow {
  id: string
  email: string
  server_id: string
  role: 'admin' | 'user'
  invited_by: string | null
  /** The XXXX-XXXX invite code. Named `token` for the column's history. */
  token: string | null
  status: 'pending' | 'accepted' | 'revoked'
  created_at: number
  expires_at: number | null
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
    token: string
  },
): Promise<void> {
  // Re-inviting the same (email, server) refreshes the row AND mints a fresh
  // code, so an older leaked link stops working once a new invite is sent.
  const createdAt = now()
  await env.DB.prepare(
    `INSERT INTO pending_invites
       (id, email, server_id, role, invited_by, token, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
     ON CONFLICT (email, server_id) DO UPDATE SET
       role = excluded.role,
       invited_by = excluded.invited_by,
       token = excluded.token,
       status = 'pending',
       created_at = excluded.created_at,
       expires_at = excluded.expires_at,
       accepted_at = NULL`,
  )
    .bind(
      inv.id,
      inv.email,
      inv.serverId,
      inv.role,
      inv.invitedBy,
      inv.token,
      createdAt,
      createdAt + INVITE_TTL_MS,
    )
    .run()
}

/**
 * Count a failed invite-code redemption against an identity (the Clerk user id)
 * and report the running total inside the current window.
 *
 * Durable on purpose: the in-isolate limiter used elsewhere only dampens a
 * single warm isolate, which is not enough when the secret is a ~40-bit code an
 * attacker can grind across isolates. Keyed on the authenticated user rather
 * than IP because /invite/accept already requires a session - that makes the
 * limit meaningful (an attacker needs a fresh account per bucket) and avoids
 * punishing everyone behind a shared NAT.
 */
export async function bumpInviteAttempts(
  env: Env,
  key: string,
  windowMs: number,
): Promise<number> {
  const t = now()
  const windowStart = t - (t % windowMs)
  await env.DB.prepare(
    `INSERT INTO invite_attempts (key, window_start, attempts)
     VALUES (?, ?, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET attempts = attempts + 1`,
  )
    .bind(key, windowStart)
    .run()
  const r = await env.DB.prepare(
    `SELECT attempts FROM invite_attempts WHERE key = ? AND window_start = ?`,
  )
    .bind(key, windowStart)
    .first<{ attempts: number }>()
  return r?.attempts ?? 1
}

/** Revoke a pending invite (admin cancels it). Idempotent; only touches rows for
 *  the given server so an admin can't revoke another server's invite by id. */
export async function revokeInvite(env: Env, serverId: string, id: string): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE pending_invites SET status = 'revoked'
      WHERE id = ? AND server_id = ? AND status = 'pending'`,
  )
    .bind(id, serverId)
    .run()
  return (r.meta?.changes ?? 0) > 0
}

/**
 * A single live invite by its code, with server details. This is the relay-proof
 * acceptance path: possession of the code authorizes the link, independent of
 * the account's own email.
 *
 * Enforces expiry here rather than at the call site so no caller can forget it -
 * an expired code is indistinguishable from a wrong one.
 */
export async function inviteByToken(
  env: Env,
  token: string,
): Promise<(InviteRow & { public_url: string; server_name: string | null }) | null> {
  const r = await env.DB.prepare(
    `SELECT i.*, s.public_url, s.name AS server_name
       FROM pending_invites i JOIN servers s ON s.server_id = i.server_id
      WHERE i.token = ? AND i.status = 'pending'
        AND (i.expires_at IS NULL OR i.expires_at > ?)`,
  )
    .bind(token, now())
    .first<InviteRow & { public_url: string; server_name: string | null }>()
  return r ?? null
}

/** All pending invites for a (verified) email, with server details. */
export async function pendingInvitesForEmail(
  env: Env,
  email: string,
): Promise<Array<InviteRow & { public_url: string; server_name: string | null }>> {
  const r = await env.DB.prepare(
    `SELECT i.*, s.public_url, s.name AS server_name
       FROM pending_invites i JOIN servers s ON s.server_id = i.server_id
      WHERE i.email = ? AND i.status = 'pending'
        AND (i.expires_at IS NULL OR i.expires_at > ?)`,
  )
    .bind(email.toLowerCase(), now())
    .all<InviteRow & { public_url: string; server_name: string | null }>()
  return r.results ?? []
}

export async function markInviteAccepted(env: Env, id: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE pending_invites SET status = 'accepted', accepted_at = ? WHERE id = ?`,
  )
    .bind(now(), id)
    .run()
}

/** Live invites an admin can see for a server they manage. Expired rows are
 *  filtered out so the list matches what a code can actually still redeem. */
export async function pendingInvitesForServer(env: Env, serverId: string): Promise<InviteRow[]> {
  const r = await env.DB.prepare(
    `SELECT * FROM pending_invites
      WHERE server_id = ? AND status = 'pending'
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC`,
  )
    .bind(serverId, now())
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
    `SELECT sent FROM email_quota WHERE server_id = ? AND window_start = ?`,
  )
    .bind(serverId, monthWindowStart())
    .first<{ sent: number }>()
  return r?.sent ?? 0
}

/** Current-window send counts for every server, keyed by server_id - for the
 *  fleet roster list (avoids N+1). */
export async function listAllEmailSentThisWindow(env: Env): Promise<Map<string, number>> {
  const r = await env.DB.prepare(`SELECT server_id, sent FROM email_quota WHERE window_start = ?`)
    .bind(monthWindowStart())
    .all<{ server_id: string; sent: number }>()
  return new Map((r.results ?? []).map((row) => [row.server_id, row.sent]))
}

/** Increment a server's send count for the current window (creating the row). */
export async function incrementEmailSent(env: Env, serverId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO email_quota (server_id, window_start, sent, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT (server_id, window_start) DO UPDATE SET
       sent = sent + 1,
       updated_at = excluded.updated_at`,
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
  opts: { clerkUserId?: string; email?: string },
): Promise<PlatformAdminRow | null> {
  const id = opts.clerkUserId ?? ''
  const email = (opts.email ?? '').toLowerCase()
  if (!id && !email) return null
  return env.DB.prepare(
    `SELECT * FROM platform_admins WHERE clerk_user_id = ? OR (email IS NOT NULL AND email = ?) LIMIT 1`,
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
  clerkUserId: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE platform_admins SET clerk_user_id = ?
       WHERE email = ? AND clerk_user_id <> ?`,
  )
    .bind(clerkUserId, email.toLowerCase(), clerkUserId)
    .run()
}

export async function listPlatformAdmins(env: Env): Promise<PlatformAdminRow[]> {
  const r = await env.DB.prepare(
    `SELECT * FROM platform_admins ORDER BY granted_at ASC`,
  ).all<PlatformAdminRow>()
  return r.results ?? []
}

export async function addPlatformAdmin(
  env: Env,
  a: { clerkUserId: string; email: string | null; role?: string; grantedBy: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO platform_admins (clerk_user_id, role, email, granted_by, granted_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       role = excluded.role, email = excluded.email`,
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
  a: { id: string; actor: string; action: string; target?: string | null; detail?: unknown },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO admin_audit (id, actor, action, target, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      a.id,
      a.actor,
      a.action,
      a.target ?? null,
      a.detail === undefined ? null : JSON.stringify(a.detail),
      now(),
    )
    .run()
}

export async function listAudit(env: Env, limit = 100): Promise<AuditRow[]> {
  const capped = Math.min(Math.max(limit, 1), 500)
  const r = await env.DB.prepare(`SELECT * FROM admin_audit ORDER BY created_at DESC LIMIT ?`)
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
export async function getEntitlement(
  env: Env,
  clerkUserId: string,
): Promise<EntitlementRow | null> {
  return env.DB.prepare(`SELECT * FROM entitlements WHERE clerk_user_id = ?`)
    .bind(clerkUserId)
    .first<EntitlementRow>()
}

/** Remove a user's plan/entitlement row (account data-deletion flow). */
export async function deleteEntitlement(env: Env, clerkUserId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM entitlements WHERE clerk_user_id = ?`).bind(clerkUserId).run()
}

/** Listing of all servers for the admin moderation view. */
export async function listAllServers(env: Env): Promise<ServerRow[]> {
  const r = await env.DB.prepare(`SELECT * FROM servers ORDER BY created_at DESC`).all<ServerRow>()
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
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO device_handles
       (handle, clerk_user_id, label, image_url, pin_hash, pin_salt, created_at, last_used_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  )
    .bind(
      h.handle,
      h.clerkUserId,
      h.label ?? null,
      h.imageUrl ?? null,
      h.pinHash ?? null,
      h.pinSalt ?? null,
      now(),
      h.expiresAt,
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
     RETURNING pin_attempts`,
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

/** Forget every remembered account-switcher handle for a user (account
 *  data-deletion flow). */
export async function deleteAllDeviceHandlesForUser(env: Env, clerkUserId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM device_handles WHERE clerk_user_id = ?`).bind(clerkUserId).run()
}

/** Every remembered account for a user (used to forget-everywhere on full logout). */
export async function listDeviceHandlesForUser(
  env: Env,
  clerkUserId: string,
): Promise<DeviceHandleRow[]> {
  const r = await env.DB.prepare(
    `SELECT * FROM device_handles WHERE clerk_user_id = ? ORDER BY created_at ASC`,
  )
    .bind(clerkUserId)
    .all<DeviceHandleRow>()
  return r.results ?? []
}
