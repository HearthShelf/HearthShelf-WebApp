/**
 * Infra log routes on the control plane.
 *
 *   POST /logs/box    - a self-hosted box forwards a warn/error event
 *                       (server_secret authed). The CP relays it to the collector.
 *   POST /logs/mobile - the phone app forwards a crash/breadcrumb report (Clerk
 *                       bearer authed). The CP tags it source='mobile', stamps the
 *                       reporting Clerk user id, and relays it to the collector.
 *   GET  /logs        - the admin viewer reads logs (Clerk + platform-admin only).
 *                       Proxies to the collector's /logs over the service binding.
 *
 * The CP itself also calls forwardLog() from its own error paths (see onError in
 * index.ts). The CP never binds the logs DB - all access is via LOG_COLLECTOR.
 */
import { Hono } from 'hono'
import type { Env } from '../types'
import { getServer } from '../lib/db'
import { sha256Hex, timingSafeEqual } from '../lib/ids'
import { resolveAdmin } from '../lib/admin'
import { bearer, verifyClerk, AuthError } from '../lib/clerk'
import { forwardLog, readLogs, deleteLog, deleteLogs } from '../lib/logs'

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

// The phone app ships crash/breadcrumb reports here. Authenticated by the user's
// Clerk bearer (same token the app already sends the control plane) so no shared
// secret ever ships in the app binary, and every report is attributed to a real
// user. Always tagged source='mobile'; the reporting user id is stamped into the
// detail so it can't be forged by the client. Best-effort: a report must never
// error the app, so anything unusable is accepted-and-dropped rather than 4xx'd
// past auth.
logs.post('/logs/mobile', async (c) => {
  const token = bearer(c.req.header('Authorization') ?? null)
  if (!token) return c.json({ error: 'unauthorized' }, 401)
  let identity
  try {
    identity = await verifyClerk(c.env, token)
  } catch (err) {
    if (err instanceof AuthError) return c.json({ error: 'unauthorized' }, 401)
    throw err
  }

  let body: {
    event?: string
    message?: string
    detail?: unknown
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'bad_body' }, 400)
  }

  // A crash report is always 'error'; there is no lower-severity mobile log path.
  const event = (body.event || 'mobile_crash').trim().slice(0, 200)
  // Stamp the verified user id into the detail envelope. The client cannot set
  // this - we overwrite whatever it sent - so reports are always attributable.
  const detail =
    body.detail && typeof body.detail === 'object'
      ? { ...(body.detail as Record<string, unknown>), userId: identity.userId }
      : { raw: body.detail ?? null, userId: identity.userId }

  await forwardLog(c.env, {
    source: 'mobile',
    severity: 'error',
    event,
    server_id: null,
    message: body.message ?? null,
    detail,
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

// Delete a single log row. Platform admins only (same gate as the viewer read).
logs.delete('/logs/:id', async (c) => {
  const ctx = await resolveAdmin(c)
  if (!ctx) {
    const authed = !!c.req.header('Authorization')
    return c.json({ error: authed ? 'forbidden' : 'unauthorized' }, authed ? 403 : 401)
  }
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'bad_id' }, 400)
  const result = await deleteLog(c.env, id)
  if (result === null) return c.json({ error: 'collector_unavailable' }, 503)
  return c.json(result)
})

// Bulk-delete logs, honoring the same source/severity/server filters as the
// viewer so "Clear" removes exactly the rows the admin is looking at. With no
// filters, clears the whole table. Platform admins only.
logs.delete('/logs', async (c) => {
  const ctx = await resolveAdmin(c)
  if (!ctx) {
    const authed = !!c.req.header('Authorization')
    return c.json({ error: authed ? 'forbidden' : 'unauthorized' }, authed ? 403 : 401)
  }
  const u = new URL(c.req.url)
  const out = new URLSearchParams()
  for (const k of ['source', 'severity', 'server_id']) {
    const v = u.searchParams.get(k)
    if (v) out.set(k, v)
  }
  const result = await deleteLogs(c.env, out.toString())
  if (result === null) return c.json({ error: 'collector_unavailable' }, 503)
  return c.json(result)
})
