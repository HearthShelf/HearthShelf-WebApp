/**
 * AI assistant connections - the long-lived credential the MCP Worker holds for
 * each connected MCP client. Read migrations/0019_mcp_connections.sql first.
 *
 * The credential is a bearer secret, so it is stored only as a hash, returned
 * once at creation, and recognisable by its prefix so it can never be mistaken
 * for (or accepted as) a session token.
 */
import type { Env } from '../types'
import { b64url, now, sha256Hex, uuid } from './ids'

export const MCP_TOKEN_PREFIX = 'hsmcp_'

/**
 * Most connections one account may hold. Every reconnect from an AI client makes
 * a new one, and the old grant is not always revoked by the client, so without a
 * cap a user who reconnects often accumulates rows. Past the cap the
 * least-recently-used connection is dropped: it is almost always the stale one a
 * reconnect replaced.
 */
const MAX_CONNECTIONS_PER_USER = 20

/** How stale last_used_at may get before a use writes it again. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000

export interface McpConnectionRow {
  id: string
  clerk_user_id: string
  token_hash: string
  client_name: string | null
  username: string
  created_at: number
  last_used_at: number | null
}

export async function createMcpConnection(
  env: Env,
  c: { clerkUserId: string; clientName: string | null; username: string },
): Promise<{ id: string; token: string }> {
  const id = uuid()
  const token = MCP_TOKEN_PREFIX + b64url(crypto.getRandomValues(new Uint8Array(32)))
  const at = now()
  await env.DB.prepare(
    `INSERT INTO mcp_connections (id, clerk_user_id, token_hash, client_name, username, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, c.clerkUserId, await sha256Hex(token), c.clientName, c.username, at, at)
    .run()

  await env.DB.prepare(
    `DELETE FROM mcp_connections
     WHERE clerk_user_id = ?
       AND id NOT IN (
         SELECT id FROM mcp_connections WHERE clerk_user_id = ?
         ORDER BY COALESCE(last_used_at, created_at) DESC LIMIT ?
       )`,
  )
    .bind(c.clerkUserId, c.clerkUserId, MAX_CONNECTIONS_PER_USER)
    .run()

  return { id, token }
}

/** Resolve a presented credential. Null for anything unknown or malformed. */
export async function findMcpConnection(env: Env, token: string): Promise<McpConnectionRow | null> {
  if (!token.startsWith(MCP_TOKEN_PREFIX)) return null
  return await env.DB.prepare(`SELECT * FROM mcp_connections WHERE token_hash = ?`)
    .bind(await sha256Hex(token))
    .first<McpConnectionRow>()
}

/** Record a use, at most once per TOUCH_INTERVAL_MS so tool calls stay read-only. */
export async function touchMcpConnection(env: Env, row: McpConnectionRow): Promise<void> {
  if (row.last_used_at && now() - row.last_used_at < TOUCH_INTERVAL_MS) return
  await env.DB.prepare(`UPDATE mcp_connections SET last_used_at = ? WHERE id = ?`)
    .bind(now(), row.id)
    .run()
}

export async function listMcpConnections(
  env: Env,
  clerkUserId: string,
): Promise<McpConnectionRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM mcp_connections WHERE clerk_user_id = ?
     ORDER BY COALESCE(last_used_at, created_at) DESC`,
  )
    .bind(clerkUserId)
    .all<McpConnectionRow>()
  return res.results ?? []
}

/** Returns false when no such connection belongs to this user. */
export async function deleteMcpConnection(
  env: Env,
  id: string,
  clerkUserId: string,
): Promise<boolean> {
  const res = await env.DB.prepare(`DELETE FROM mcp_connections WHERE id = ? AND clerk_user_id = ?`)
    .bind(id, clerkUserId)
    .run()
  return !!res.meta?.changes
}

export async function deleteAllMcpConnectionsForUser(env: Env, clerkUserId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM mcp_connections WHERE clerk_user_id = ?`)
    .bind(clerkUserId)
    .run()
}
