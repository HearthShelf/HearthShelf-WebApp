/**
 * Third-party app connections - registration, the device flow, and the
 * installation mirror.
 *
 * Companion to migrations/0016_app_connections.sql; read that first for the
 * model. Two things govern everything in this file:
 *
 *  1. Apps are split by WHERE THEY RUN. An 'instance' app (one deployment per
 *     user) may only ever be authorized by the account that registered it -
 *     enforced in canUserAuthorize(). A 'cloud' app (one deployment, many users)
 *     goes through store review first.
 *
 *  2. The control plane owns the INTRODUCTION only. There is no refresh token
 *     here: after consent we mint a short single-use introduction token per
 *     approved server and the box takes over. Anything in this file that starts
 *     to look like a long-lived credential is a mistake.
 */
import type { Env } from '../types'
import { now, sha256Hex, uuid, b64url } from './ids'
import { parseAppScopes, formatAppScopes, type AppScope } from './scopes'

export type AppKind = 'instance' | 'cloud'
export type AppListingStatus = 'unlisted' | 'pending' | 'listed'
export type DeviceCodeStatus = 'pending' | 'approved' | 'denied'

export interface AppRow {
  app_id: string
  name: string
  secret_hash: string
  kind: AppKind
  family: string | null
  homepage_url: string | null
  requested_scopes: string
  owner_clerk_user_id: string
  listing_status: AppListingStatus
  review_reason: string | null
  reviewed_by: string | null
  reviewed_at: number | null
  created_at: number
}

export interface DeviceCodeRow {
  device_code: string
  user_code: string
  app_id: string
  scopes: string
  status: DeviceCodeStatus
  clerk_user_id: string | null
  server_ids: string | null
  expires_at: number
  last_polled_at: number | null
  created_at: number
}

export interface InstallationRow {
  id: string
  app_id: string
  clerk_user_id: string
  scopes: string
  created_at: number
  last_seen_at: number | null
}

// --- identifiers -----------------------------------------------------------

/**
 * The human-typed device code. RFC 8628 recommends a base-20 CONSONANT alphabet
 * (~34.5 bits at 8 chars): no vowels means no accidental words, and dropping
 * lookalikes means no 0/O or 1/I transcription failures when someone reads it
 * off a TV or a Home Assistant config screen.
 *
 * Distinct from ids.ts's pairingCode alphabet, which includes digits - this one
 * follows the RFC because app authors may use stock OAuth tooling that assumes it.
 */
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'

export function userCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += USER_CODE_ALPHABET[bytes[i] % USER_CODE_ALPHABET.length]
    if (i === 3) out += '-'
  }
  return out
}

/** Accept whatever the user typed: "bcdf ghjk", "bcdfghjk", "BCDF-GHJK". */
export function normalizeUserCode(raw: string): string {
  const bare = raw.toUpperCase().replace(/[^A-Z]/g, '')
  if (bare.length !== 8) return ''
  for (const ch of bare) if (!USER_CODE_ALPHABET.includes(ch)) return ''
  return `${bare.slice(0, 4)}-${bare.slice(4)}`
}

/** Opaque high-entropy value the app polls with. */
export function deviceCode(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)))
}

/** App client secret. Returned once at registration, stored only as a hash. */
export function appSecret(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)))
}

/** Stable app id, prefixed so it is recognisable in logs and config files. */
export function appId(): string {
  return `app_${b64url(crypto.getRandomValues(new Uint8Array(12)))}`
}

// --- registration ----------------------------------------------------------

export async function createApp(
  env: Env,
  a: {
    name: string
    kind: AppKind
    family: string | null
    homepageUrl: string | null
    scopes: AppScope[]
    ownerClerkUserId: string
  },
): Promise<{ row: AppRow; secret: string }> {
  const id = appId()
  const secret = appSecret()
  const secretHash = await sha256Hex(secret)
  const createdAt = now()
  await env.DB.prepare(
    `INSERT INTO apps (app_id, name, secret_hash, kind, family, homepage_url,
                       requested_scopes, owner_clerk_user_id, listing_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unlisted', ?)`,
  )
    .bind(
      id,
      a.name,
      secretHash,
      a.kind,
      a.family,
      a.homepageUrl,
      formatAppScopes(a.scopes),
      a.ownerClerkUserId,
      createdAt,
    )
    .run()
  const row = await getApp(env, id)
  if (!row) throw new Error('app insert failed')
  return { row, secret }
}

export async function getApp(env: Env, id: string): Promise<AppRow | null> {
  return await env.DB.prepare(`SELECT * FROM apps WHERE app_id = ?`).bind(id).first<AppRow>()
}

export async function listAppsForOwner(env: Env, clerkUserId: string): Promise<AppRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM apps WHERE owner_clerk_user_id = ? ORDER BY created_at DESC`,
  )
    .bind(clerkUserId)
    .all<AppRow>()
  return res.results ?? []
}

/** Store listing: approved cloud apps only. */
export async function listStoreApps(env: Env): Promise<AppRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM apps WHERE listing_status = 'listed' AND kind = 'cloud' ORDER BY name`,
  ).all<AppRow>()
  return res.results ?? []
}

export async function listPendingReviewApps(env: Env): Promise<AppRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM apps WHERE listing_status = 'pending' ORDER BY created_at`,
  ).all<AppRow>()
  return res.results ?? []
}

export async function rotateAppSecret(env: Env, id: string): Promise<string> {
  const secret = appSecret()
  await env.DB.prepare(`UPDATE apps SET secret_hash = ? WHERE app_id = ?`)
    .bind(await sha256Hex(secret), id)
    .run()
  return secret
}

/** Deleting an app revokes every authorization anyone held for it (cascade). */
export async function deleteApp(env: Env, id: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM apps WHERE app_id = ?`).bind(id).run()
}

export async function setListingStatus(
  env: Env,
  id: string,
  status: AppListingStatus,
  opts: { reason?: string | null; reviewedBy?: string | null } = {},
): Promise<void> {
  await env.DB.prepare(
    `UPDATE apps SET listing_status = ?, review_reason = ?, reviewed_by = ?, reviewed_at = ?
     WHERE app_id = ?`,
  )
    .bind(status, opts.reason ?? null, opts.reviewedBy ?? null, now(), id)
    .run()
}

/**
 * Update an app's requested scopes. Broadening the ask on a LISTED app drops it
 * back to 'pending': approval covered what the app asked for at review time, and
 * silently widening it afterwards would make review a bait and switch.
 */
export async function setRequestedScopes(
  env: Env,
  row: AppRow,
  scopes: AppScope[],
): Promise<AppListingStatus> {
  const before = parseAppScopes(row.requested_scopes).scopes
  const widened = scopes.some((s) => !before.includes(s))
  const status: AppListingStatus =
    row.listing_status === 'listed' && widened ? 'pending' : row.listing_status
  await env.DB.prepare(`UPDATE apps SET requested_scopes = ?, listing_status = ? WHERE app_id = ?`)
    .bind(formatAppScopes(scopes), status, row.app_id)
    .run()
  return status
}

// --- the authorization gate ------------------------------------------------

/**
 * May this user authorize this app? THE security boundary of the whole design.
 *
 * An 'instance' app is one deployment per user, so only the account that
 * registered it may connect it. This is what makes open registration safe:
 * someone registering a lookalike "Audplexus" and phishing a code out of a
 * stranger is refused HERE, before any consent screen renders. A control that
 * refuses beats a badge the user has to read.
 *
 * A 'cloud' app is one deployment serving many users, so anyone may authorize it
 * once it has been reviewed into the store - its own developer may also connect
 * it while it is still unlisted, which is how they test it.
 */
export function canUserAuthorize(app: AppRow, clerkUserId: string): boolean {
  if (app.owner_clerk_user_id === clerkUserId) return true
  if (app.kind === 'cloud') return app.listing_status === 'listed'
  return false
}

// --- device flow -----------------------------------------------------------

export async function createDeviceCode(
  env: Env,
  d: { appId: string; scopes: AppScope[]; ttlSeconds: number },
): Promise<DeviceCodeRow> {
  const code = deviceCode()
  const user = userCode()
  const createdAt = now()
  await env.DB.prepare(
    `INSERT INTO app_device_codes (device_code, user_code, app_id, scopes, status,
                                   expires_at, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
  )
    .bind(code, user, d.appId, formatAppScopes(d.scopes), createdAt + d.ttlSeconds * 1000, createdAt)
    .run()
  const row = await getDeviceCode(env, code)
  if (!row) throw new Error('device code insert failed')
  return row
}

export async function getDeviceCode(env: Env, code: string): Promise<DeviceCodeRow | null> {
  return await env.DB.prepare(`SELECT * FROM app_device_codes WHERE device_code = ?`)
    .bind(code)
    .first<DeviceCodeRow>()
}

export async function getDeviceCodeByUserCode(
  env: Env,
  userCodeValue: string,
): Promise<DeviceCodeRow | null> {
  return await env.DB.prepare(`SELECT * FROM app_device_codes WHERE user_code = ?`)
    .bind(userCodeValue)
    .first<DeviceCodeRow>()
}

export async function touchDeviceCodePoll(env: Env, code: string): Promise<void> {
  await env.DB.prepare(`UPDATE app_device_codes SET last_polled_at = ? WHERE device_code = ?`)
    .bind(now(), code)
    .run()
}

export async function approveDeviceCode(
  env: Env,
  code: string,
  approval: { clerkUserId: string; serverIds: string[]; scopes: AppScope[] },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE app_device_codes
     SET status = 'approved', clerk_user_id = ?, server_ids = ?, scopes = ?
     WHERE device_code = ?`,
  )
    .bind(approval.clerkUserId, approval.serverIds.join(','), formatAppScopes(approval.scopes), code)
    .run()
}

export async function denyDeviceCode(env: Env, code: string): Promise<void> {
  await env.DB.prepare(`UPDATE app_device_codes SET status = 'denied' WHERE device_code = ?`)
    .bind(code)
    .run()
}

/** Spend the code. Terminal states are read exactly once, then the row is gone. */
export async function consumeDeviceCode(env: Env, code: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM app_device_codes WHERE device_code = ?`).bind(code).run()
}

/** Opportunistic sweep of expired rows so the table does not accumulate. */
export async function sweepDeviceCodes(env: Env): Promise<void> {
  await env.DB.prepare(`DELETE FROM app_device_codes WHERE expires_at < ?`)
    .bind(now() - 60_000)
    .run()
}

// --- installations (MIRROR - the box is authoritative) ----------------------

/**
 * Record that a user connected an app to a set of servers.
 *
 * Re-authorizing an app the user already connected UPDATES that row rather than
 * accumulating duplicates - a connections page listing "Audplexus" four times
 * because someone reconnected is a bug, not history.
 *
 * Remember this is a mirror. It says what the control plane last knew, not what
 * the box will honour; never present it as authoritative.
 */
export async function upsertInstallation(
  env: Env,
  i: { appId: string; clerkUserId: string; scopes: AppScope[]; serverIds: string[] },
): Promise<InstallationRow> {
  const existing = await env.DB.prepare(
    `SELECT * FROM app_installations WHERE app_id = ? AND clerk_user_id = ?`,
  )
    .bind(i.appId, i.clerkUserId)
    .first<InstallationRow>()

  const id = existing?.id ?? uuid()
  const at = now()
  if (existing) {
    await env.DB.prepare(
      `UPDATE app_installations SET scopes = ?, last_seen_at = ? WHERE id = ?`,
    )
      .bind(formatAppScopes(i.scopes), at, id)
      .run()
  } else {
    await env.DB.prepare(
      `INSERT INTO app_installations (id, app_id, clerk_user_id, scopes, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, i.appId, i.clerkUserId, formatAppScopes(i.scopes), at, at)
      .run()
  }

  for (const serverId of i.serverIds) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO app_installation_servers (installation_id, server_id, created_at)
       VALUES (?, ?, ?)`,
    )
      .bind(id, serverId, at)
      .run()
  }

  const row = await env.DB.prepare(`SELECT * FROM app_installations WHERE id = ?`)
    .bind(id)
    .first<InstallationRow>()
  if (!row) throw new Error('installation upsert failed')
  return row
}

export interface InstallationWithServers extends InstallationRow {
  app_name: string
  kind: AppKind
  family: string | null
  server_ids: string[]
}

export async function listInstallationsForUser(
  env: Env,
  clerkUserId: string,
): Promise<InstallationWithServers[]> {
  const res = await env.DB.prepare(
    `SELECT i.*, a.name AS app_name, a.kind, a.family
     FROM app_installations i
     JOIN apps a ON a.app_id = i.app_id
     WHERE i.clerk_user_id = ?
     ORDER BY i.created_at DESC`,
  )
    .bind(clerkUserId)
    .all<InstallationRow & { app_name: string; kind: AppKind; family: string | null }>()

  const rows = res.results ?? []
  const out: InstallationWithServers[] = []
  for (const row of rows) {
    const servers = await env.DB.prepare(
      `SELECT server_id FROM app_installation_servers WHERE installation_id = ?`,
    )
      .bind(row.id)
      .all<{ server_id: string }>()
    out.push({ ...row, server_ids: (servers.results ?? []).map((s) => s.server_id) })
  }
  return out
}

export async function getInstallation(
  env: Env,
  id: string,
  clerkUserId: string,
): Promise<InstallationRow | null> {
  return await env.DB.prepare(
    `SELECT * FROM app_installations WHERE id = ? AND clerk_user_id = ?`,
  )
    .bind(id, clerkUserId)
    .first<InstallationRow>()
}

export async function installationServerIds(env: Env, id: string): Promise<string[]> {
  const res = await env.DB.prepare(
    `SELECT server_id FROM app_installation_servers WHERE installation_id = ?`,
  )
    .bind(id)
    .all<{ server_id: string }>()
  return (res.results ?? []).map((r) => r.server_id)
}

export async function deleteInstallation(env: Env, id: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM app_installations WHERE id = ?`).bind(id).run()
}

/** Withdraw ONE server from an installation, leaving the others working. */
export async function removeInstallationServer(
  env: Env,
  id: string,
  serverId: string,
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM app_installation_servers WHERE installation_id = ? AND server_id = ?`,
  )
    .bind(id, serverId)
    .run()
}

/**
 * Every installation touching a server, for the unlink cascade. The FK already
 * removes the join row; callers use this FIRST to learn which boxes to notify,
 * since the box holds the credential that actually needs revoking.
 */
export async function installationsForServer(
  env: Env,
  serverId: string,
): Promise<Array<{ installation_id: string; app_id: string; clerk_user_id: string }>> {
  const res = await env.DB.prepare(
    `SELECT s.installation_id, i.app_id, i.clerk_user_id
     FROM app_installation_servers s
     JOIN app_installations i ON i.id = s.installation_id
     WHERE s.server_id = ?`,
  )
    .bind(serverId)
    .all<{ installation_id: string; app_id: string; clerk_user_id: string }>()
  return res.results ?? []
}

/** Drop every app authorization a given user held for one server. */
export async function removeUserInstallationsForServer(
  env: Env,
  clerkUserId: string,
  serverId: string,
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM app_installation_servers
     WHERE server_id = ?
       AND installation_id IN (SELECT id FROM app_installations WHERE clerk_user_id = ?)`,
  )
    .bind(serverId, clerkUserId)
    .run()
  // An installation that now reaches nothing is inert - clear it so the
  // connections page does not show a connection that can touch no server.
  await env.DB.prepare(
    `DELETE FROM app_installations
     WHERE clerk_user_id = ?
       AND id NOT IN (SELECT installation_id FROM app_installation_servers)`,
  )
    .bind(clerkUserId)
    .run()
}

// --- registration rate limiting --------------------------------------------

const REG_WINDOW_MS = 60 * 60 * 1000
const REG_MAX_PER_WINDOW = 10

/**
 * Bound app creation per actor. Registration mints an identity, not an
 * authorization, so this is not a security boundary - it just means squatting
 * plausible names has a cost. `actor` is a Clerk user id for console
 * registrations, or 'family:<name>|<ip>' for unauthenticated instance ones.
 */
export async function registrationRateLimited(env: Env, actor: string): Promise<boolean> {
  const since = now() - REG_WINDOW_MS
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM app_registration_attempts WHERE actor = ? AND at > ?`,
  )
    .bind(actor, since)
    .first<{ n: number }>()
  if ((row?.n ?? 0) >= REG_MAX_PER_WINDOW) return true
  await env.DB.prepare(`INSERT INTO app_registration_attempts (actor, at) VALUES (?, ?)`)
    .bind(actor, now())
    .run()
  return false
}
