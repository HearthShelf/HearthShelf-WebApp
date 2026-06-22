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

// --- links -----------------------------------------------------------------

export async function listLinksForUser(env: Env, clerkUserId: string): Promise<
  Array<LinkRow & { public_url: string; server_name: string | null }>
> {
  const r = await env.DB.prepare(
    `SELECT l.*, s.public_url, s.name AS server_name
       FROM links l JOIN servers s ON s.server_id = l.server_id
      WHERE l.clerk_user_id = ?
      ORDER BY l.created_at ASC`
  )
    .bind(clerkUserId)
    .all<LinkRow & { public_url: string; server_name: string | null }>()
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
