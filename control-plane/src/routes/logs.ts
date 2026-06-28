/**
 * Infra log routes on the control plane.
 *
 *   POST /logs/box   - a self-hosted box forwards a warn/error event
 *                      (server_secret authed). The CP relays it to the collector.
 *   GET  /logs       - the admin viewer reads logs (Clerk + platform-admin only).
 *                      Proxies to the collector's /logs over the service binding.
 *
 * The CP itself also calls forwardLog() from its own error paths (see onError in
 * index.ts). The CP never binds the logs DB - all access is via LOG_COLLECTOR.
 */
import { Hono } from 'hono'
import type { Env } from '../types'
import { getServer } from '../lib/db'
import { sha256Hex, timingSafeEqual } from '../lib/ids'
import { resolveAdmin } from '../lib/admin'
import { forwardLog, readLogs } from '../lib/logs'

export const logs = new Hono<{ Bindings: Env }>()

// A self-hosted box ships its own connect/cert errors here. Authenticated by the
// server_secret (same scheme as /servers/name, /servers/deregister) so only a
// genuinely-paired box can write, and only ever tagged source='box'.
logs.post('/logs/box', async (c) => {
  let body: {
    server_id?: string
    server_secret?: string
    severity?: string
    event?: string
    message?: string
    detail?: unknown
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'bad_body' }, 400)
  }
  const serverId = body.server_id || ''
  const secret = body.server_secret || ''
  if (!serverId || !secret) return c.json({ error: 'server_id and server_secret required' }, 400)
  const server = await getServer(c.env, serverId)
  if (!server) return c.json({ error: 'unknown_server' }, 404)
  const presented = await sha256Hex(secret)
  if (!timingSafeEqual(presented, server.server_secret_hash)) {
    return c.json({ error: 'bad_server_secret' }, 401)
  }
  // Only warn/error are meaningful; the collector drops the rest anyway.
  const severity = body.severity === 'error' ? 'error' : 'warn'
  const event = (body.event || '').trim()
  if (!event) return c.json({ error: 'event required' }, 400)
  await forwardLog(c.env, {
    source: 'box',
    severity,
    event,
    server_id: serverId,
    message: body.message ?? null,
    detail: body.detail ?? null,
  })
  return c.json({ ok: true })
})

// Admin viewer read. Platform admins only (the platform_admins D1 table, the same
// gate as the rest of the admin panel), NOT per-server admins. Proxies the query
// through to the collector.
logs.get('/logs', async (c) => {
  const ctx = await resolveAdmin(c)
  if (!ctx) {
    const authed = !!c.req.header('Authorization')
    return c.json({ error: authed ? 'forbidden' : 'unauthorized' }, authed ? 403 : 401)
  }

  // Pass through only the whitelisted query params so we don't proxy junk.
  const u = new URL(c.req.url)
  const out = new URLSearchParams()
  for (const k of ['source', 'severity', 'server_id', 'since', 'before_id', 'limit']) {
    const v = u.searchParams.get(k)
    if (v) out.set(k, v)
  }
  const result = await readLogs(c.env, out.toString())
  if (result === null) return c.json({ error: 'collector_unavailable', logs: [] }, 503)
  return c.json(result)
})
