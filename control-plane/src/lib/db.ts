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

// Rotate an already-registered server's secret hash at /pairing/start, so the
// fresh secret the box receives validates immediately against the servers row
// (cert-grant + the server_secret-authed routes read servers, not the pairing
// row). Without this, re-pairing drifted the box's secret from the row until the
// next redeem rewrote it - the bad_server_secret bug. No-op if the row is absent.
export async function setServerSecretHash(
  env: Env,
  serverId: string,
  secretHash: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE servers SET server_secret_hash = ?, last_seen_at = ? WHERE server_id = ?`
  )
    .bind(secretHash, now(), serverId)
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

// --- per-server OAuth clients (hosted OIDC) --------------------------------

export interface OAuthClientRow {
  server_id: string
  clerk_app_id: string
  client_id: string
  client_secret: string | null
  redirect_uri: string
  applied_at: number | null
  created_at: number
}

export async function upsertOAuthClient(
  env: Env,
  c: {
    serverId: string
    clerkAppId: string
    clientId: string
    clientSecret: string | null
    redirectUri: string
  }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO oauth_clients
       (server_id, clerk_app_id, client_id, client_secret, redirect_uri, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (server_id) DO UPDATE SET
       clerk_app_id = excluded.clerk_app_id,
       client_id = excluded.client_id,
       client_secret = excluded.client_secret,
       redirect_uri = excluded.redirect_uri,
       applied_at = NULL`
  )
    .bind(c.serverId, c.clerkAppId, c.clientId, c.clientSecret, c.redirectUri, now())
    .run()
}

export async function getOAuthClient(
  env: Env,
  serverId: string
): Promise<OAuthClientRow | null> {
  return env.DB.prepare(`SELECT * FROM oauth_clients WHERE server_id = ?`)
    .bind(serverId)
    .first<OAuthClientRow>()
}

/** Clear the one-time secret once the server has applied its OIDC config. */
export async function markOAuthClientApplied(env: Env, serverId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE oauth_clients SET client_secret = NULL, applied_at = ? WHERE server_id = ?`
  )
    .bind(now(), serverId)
    .run()
}

export async function deleteOAuthClientRow(env: Env, serverId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM oauth_clients WHERE server_id = ?`).bind(serverId).run()
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
      c.status === 'failed' ? (c.lastError ?? null) : null,
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
