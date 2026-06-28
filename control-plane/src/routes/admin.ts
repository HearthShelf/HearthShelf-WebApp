/**
 * Platform-admin API. Powers the app.hearthshelf.com admin panel: fleet-wide
 * server/user moderation, plan (entitlement) management, the admin roster, and
 * the audit trail.
 *
 * The WHOLE router is gated by requireAdmin middleware (applied once below), so a
 * handler physically cannot ship without the gate. Admin status is re-read from
 * D1 per request inside that middleware - never trusted from a JWT or the client.
 * Every mutating action writes an admin_audit row.
 *
 * Scope here is moderation + entitlements only. The infra LOG VIEWER lives in
 * routes/logs.ts (owned separately) and now shares this same requireAdmin gate.
 */
import { Hono } from 'hono'
import type { Env } from '../types'
import { requireAdmin, type AdminContext } from '../lib/admin'
import {
  listAllServers,
  getServer,
  deleteServer,
  listLinksForServer,
  listLinksByUser,
  getServerCert,
  emailSentThisWindow,
  getEntitlement,
  setEntitlement,
  listPlatformAdmins,
  addPlatformAdmin,
  removePlatformAdmin,
  countPlatformAdmins,
  getPlatformAdmin,
  writeAudit,
  listAudit,
} from '../lib/db'
import { uuid } from '../lib/ids'

// The router carries the resolved admin context in `c.var.admin`.
export const admin = new Hono<{ Bindings: Env; Variables: { admin: AdminContext } }>()

// One gate for the whole sub-router. Everything under /admin/* requires a verified
// Clerk identity that maps to a platform_admins row.
admin.use('/admin/*', requireAdmin)

const RELAY_CAP = (env: Env) => Number(env.EMAIL_RELAY_MONTHLY_CAP || '500')

/** Who am I - lets the SPA decide whether to show the admin area at all. The real
 *  gate is server-side; this is only for UI routing. */
admin.get('/admin/me', (c) => {
  const { user, admin } = c.var.admin
  return c.json({ clerk_user_id: user.userId, email: user.email, role: admin.role })
})

/** Fleet roster: every server with its linked-user count + plan/quota at a glance. */
admin.get('/admin/servers', async (c) => {
  const servers = await listAllServers(c.env)
  return c.json({
    servers: servers.map((s) => ({
      id: s.server_id,
      name: s.name,
      url: s.public_url,
      link_count: s.link_count,
      created_at: s.created_at,
      last_seen_at: s.last_seen_at,
    })),
  })
})

/** Inspect one server: links, cert status, email-relay usage. */
admin.get('/admin/servers/:id', async (c) => {
  const serverId = c.req.param('id')
  const server = await getServer(c.env, serverId)
  if (!server) return c.json({ error: 'not_found' }, 404)

  const [links, cert, sent] = await Promise.all([
    listLinksForServer(c.env, serverId),
    getServerCert(c.env, serverId),
    emailSentThisWindow(c.env, serverId),
  ])
  return c.json({
    id: server.server_id,
    name: server.name,
    url: server.public_url,
    created_at: server.created_at,
    last_seen_at: server.last_seen_at,
    cert: cert ? { status: cert.status, not_after: cert.not_after, hash: cert.hash } : null,
    email_relay: { sent_this_window: sent, monthly_cap: RELAY_CAP(c.env) },
    links: links.map((l) => ({
      clerk_user_id: l.clerk_user_id,
      email: l.email,
      role: l.role,
      created_at: l.created_at,
    })),
  })
})

/**
 * Hard-deregister a server (moderation). Same teardown as the box-initiated
 * /servers/deregister: delete the server row - links / invites / certs cascade.
 * Destructive and not reversible (the operator must re-pair). Audited.
 */
admin.delete('/admin/servers/:id', async (c) => {
  const { user } = c.var.admin
  const serverId = c.req.param('id')
  const server = await getServer(c.env, serverId)
  if (!server) return c.json({ ok: true }) // idempotent

  await deleteServer(c.env, serverId)
  await writeAudit(c.env, {
    id: uuid(),
    actor: user.userId,
    action: 'deregister_server',
    target: serverId,
    detail: { name: server.name, url: server.public_url },
  })
  return c.json({ ok: true })
})

/** Inspect a user: their server links + current plan. */
admin.get('/admin/users/:clerkUserId', async (c) => {
  const clerkUserId = c.req.param('clerkUserId')
  const [links, ent] = await Promise.all([
    listLinksByUser(c.env, clerkUserId),
    getEntitlement(c.env, clerkUserId),
  ])
  return c.json({
    clerk_user_id: clerkUserId,
    plan: ent?.plan ?? 'free',
    plan_source: ent?.source ?? null,
    links: links.map((l) => ({
      server_id: l.server_id,
      email: l.email,
      role: l.role,
      created_at: l.created_at,
    })),
  })
})

/**
 * Manually set a user's plan (the only entitlement lever until billing lands).
 * source is recorded as 'manual'. Audited. Billing webhooks will later write the
 * same table with source 'stripe'.
 */
admin.post('/admin/entitlements', async (c) => {
  const { user } = c.var.admin
  let body: { clerk_user_id?: string; plan?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const clerkUserId = (body.clerk_user_id || '').trim()
  const plan = body.plan === 'pro' ? 'pro' : 'free'
  if (!clerkUserId) return c.json({ error: 'clerk_user_id required' }, 400)

  await setEntitlement(c.env, { clerkUserId, plan, source: 'manual', grantedBy: user.userId })
  await writeAudit(c.env, {
    id: uuid(),
    actor: user.userId,
    action: 'set_plan',
    target: clerkUserId,
    detail: { plan },
  })
  return c.json({ ok: true, clerk_user_id: clerkUserId, plan })
})

// --- admin roster ----------------------------------------------------------

/** List platform admins. */
admin.get('/admin/admins', async (c) => {
  const admins = await listPlatformAdmins(c.env)
  return c.json({
    admins: admins.map((a) => ({
      clerk_user_id: a.clerk_user_id,
      email: a.email,
      role: a.role,
      granted_by: a.granted_by,
      granted_at: a.granted_at,
    })),
  })
})

/**
 * Add a platform admin. Seed by email (clerk_user_id backfilled on their first
 * sign-in, like the migration seed) or by a known clerk_user_id. Audited.
 */
admin.post('/admin/admins', async (c) => {
  const { user } = c.var.admin
  let body: { clerk_user_id?: string; email?: string; role?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const email = (body.email || '').trim().toLowerCase()
  const clerkUserId = (body.clerk_user_id || '').trim() || (email ? `seed:${email}` : '')
  if (!clerkUserId) return c.json({ error: 'clerk_user_id or email required' }, 400)
  const role = body.role === 'support' ? 'support' : 'admin'

  await addPlatformAdmin(c.env, {
    clerkUserId,
    email: email || null,
    role,
    grantedBy: user.userId,
  })
  await writeAudit(c.env, {
    id: uuid(),
    actor: user.userId,
    action: 'add_admin',
    target: clerkUserId,
    detail: { email: email || null, role },
  })
  return c.json({ ok: true, clerk_user_id: clerkUserId, email: email || null, role })
})

/**
 * Remove a platform admin. Refuses to remove the last remaining admin (lockout
 * guard) and refuses self-removal (avoid an accidental own-foot-shot mid-session).
 * Audited.
 */
admin.delete('/admin/admins/:clerkUserId', async (c) => {
  const { user } = c.var.admin
  const target = c.req.param('clerkUserId')
  if (target === user.userId) return c.json({ error: 'cannot_remove_self' }, 400)

  const existing = await getPlatformAdmin(c.env, { clerkUserId: target })
  if (!existing) return c.json({ ok: true }) // idempotent
  if ((await countPlatformAdmins(c.env)) <= 1) {
    return c.json({ error: 'cannot_remove_last_admin' }, 409)
  }

  await removePlatformAdmin(c.env, target)
  await writeAudit(c.env, {
    id: uuid(),
    actor: user.userId,
    action: 'remove_admin',
    target,
    detail: { email: existing.email },
  })
  return c.json({ ok: true })
})

/** The audit trail (most recent first). */
admin.get('/admin/audit', async (c) => {
  const limit = Number(c.req.query('limit') || '100')
  const rows = await listAudit(c.env, Number.isFinite(limit) ? limit : 100)
  return c.json({ audit: rows })
})
