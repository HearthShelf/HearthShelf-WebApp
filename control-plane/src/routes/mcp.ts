/**
 * AI assistant connections (the MCP Worker at mcp.hearthshelf.com).
 *
 * Read migrations/0019_mcp_connections.sql first. The shape:
 *
 *   User-facing (session-authenticated):
 *     POST   /mcp/connections        - called by the MCP Worker at consent time,
 *                                      with the approving user's session; returns
 *                                      the connection credential ONCE
 *     GET    /mcp/connections        - the Connections page
 *     DELETE /mcp/connections/:id    - disconnect
 *
 *   Connection-credential-authenticated (the MCP Worker, at tool-call time):
 *     GET    /mcp/servers            - same list as GET /servers
 *     POST   /mcp/servers/:id/grant  - same grant as POST /servers/:id/grant
 *
 * The credential is accepted by the last two routes and nowhere else. Keep it
 * that way: it outlives every session, so it must reach no more than an AI
 * client needs.
 *
 * Disconnecting takes effect at the MCP Worker's next control-plane call, which
 * is at most ABS_TOKEN_TTL_SECONDS away (it caches the box token that long).
 */
import { Hono, type Context } from 'hono'
import type { Env } from '../types'
import { bearer } from '../lib/clerk'
import { verifyIdentity, AuthError, type AuthIdentity } from '../lib/identity'
import {
  createMcpConnection,
  findMcpConnection,
  touchMcpConnection,
  listMcpConnections,
  deleteMcpConnection,
  type McpConnectionRow,
} from '../lib/mcpConnections'
import { linkedServersFor, grantFor } from './servers'

export const mcp = new Hono<{ Bindings: Env }>()

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

async function requireConnection(c: Context<{ Bindings: Env }>): Promise<McpConnectionRow | null> {
  const token = bearer(c.req.header('Authorization') ?? null)
  if (!token) return null
  const row = await findMcpConnection(c.env, token)
  if (row) c.executionCtx?.waitUntil?.(touchMcpConnection(c.env, row).catch(() => {}))
  return row
}

mcp.post('/mcp/connections', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  if (!user.emailVerified) return c.json({ error: 'email_unverified' }, 403)

  let body: { client_name?: unknown } = {}
  try {
    body = await c.req.json()
  } catch {
    // A missing body only means no client name.
  }
  const clientName =
    typeof body.client_name === 'string' && body.client_name.trim()
      ? body.client_name.trim().slice(0, 100)
      : null

  const { id, token } = await createMcpConnection(c.env, {
    clerkUserId: user.userId,
    clientName,
    username: user.username,
  })
  return c.json({ id, token })
})

mcp.get('/mcp/connections', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const rows = await listMcpConnections(c.env, user.userId)
  return c.json({
    connections: rows.map((r) => ({
      id: r.id,
      client_name: r.client_name,
      created_at: r.created_at,
      last_used_at: r.last_used_at,
    })),
  })
})

mcp.delete('/mcp/connections/:id', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const ok = await deleteMcpConnection(c.env, c.req.param('id'), user.userId)
  if (!ok) return c.json({ error: 'not_found' }, 404)
  return c.json({ ok: true })
})

mcp.get('/mcp/servers', async (c) => {
  const conn = await requireConnection(c)
  if (!conn) return c.json({ error: 'unauthorized' }, 401)
  return c.json({ servers: await linkedServersFor(c.env, conn.clerk_user_id) })
})

mcp.post('/mcp/servers/:id/grant', async (c) => {
  const conn = await requireConnection(c)
  if (!conn) return c.json({ error: 'unauthorized' }, 401)
  const result = await grantFor(c.env, conn.clerk_user_id, conn.username, c.req.param('id'))
  if ('error' in result) return c.json({ error: result.error }, 404)
  return c.json(result)
})
