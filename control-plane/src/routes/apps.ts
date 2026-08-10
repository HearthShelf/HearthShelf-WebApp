/**
 * Third-party app connections.
 *
 * Read migrations/0016_app_connections.sql and lib/apps.ts first. The shape:
 *
 *   App-facing (no Clerk session - the app authenticates as itself):
 *     POST /apps/register            - RFC 7591 registration, both kinds
 *     POST /apps/device/code         - RFC 8628 start; returns the user code
 *     POST /apps/device/token        - RFC 8628 poll; returns introductions
 *
 *   User-facing (Clerk-authenticated, called by the SPA):
 *     GET    /apps/pending/:userCode - what am I being asked to approve?
 *     POST   /apps/approve           - approve, choosing servers
 *     POST   /apps/deny              - decline
 *     GET    /apps/mine              - the dev console
 *     POST   /apps/mine              - create an app from the console
 *     POST   /apps/mine/:id/secret   - rotate
 *     DELETE /apps/mine/:id          - delete (revokes everyone's access)
 *     POST   /apps/mine/:id/submit   - submit for store review
 *     GET    /apps/store             - browse listed apps
 *     GET    /apps/installations     - the connections page (mirror)
 *     DELETE /apps/installations/:id - revoke (forwarded to the box)
 *     DELETE /apps/installations/:id/servers/:serverId - withdraw one server
 *
 * TWO THINGS THAT MUST NOT BE WEAKENED:
 *
 *  1. canUserAuthorize(). An 'instance' app is authorizable ONLY by the account
 *     that registered it. That is what makes open registration safe - a
 *     lookalike app phishing a code from a stranger is refused before the
 *     consent screen renders. It is checked at BOTH the pending-lookup and the
 *     approve step, because the lookup is what a phisher would drive.
 *
 *  2. Revocation is forwarded to the box, and a forward that fails is REPORTED
 *     as failed. The box holds the real credential; deleting our mirror row
 *     while the app keeps working would be a lie told to someone trying to cut
 *     off an app that is misbehaving.
 */
import { Hono, type Context } from 'hono'
import type { Env } from '../types'
import { bearer, verifyClerk, AuthError, type ClerkIdentity } from '../lib/clerk'
import { resolveAdmin } from '../lib/admin'
import {
  createApp,
  getApp,
  listAppsForOwner,
  listStoreApps,
  listPendingReviewApps,
  rotateAppSecret,
  deleteApp,
  setListingStatus,
  setRequestedScopes,
  canUserAuthorize,
  createDeviceCode,
  getDeviceCode,
  getDeviceCodeByUserCode,
  touchDeviceCodePoll,
  approveDeviceCode,
  denyDeviceCode,
  consumeDeviceCode,
  sweepDeviceCodes,
  upsertInstallation,
  listInstallationsForUser,
  getInstallation,
  installationServerIds,
  deleteInstallation,
  removeInstallationServer,
  registrationRateLimited,
  normalizeUserCode,
  type AppRow,
} from '../lib/apps'
import { parseAppScopes, formatAppScopes, type AppScope } from '../lib/scopes'
import { getLink, getServer, getServerLocalAddr, writeAudit, listLinksForUser } from '../lib/db'
import { mintAppIntroduction } from '../lib/signing'
import { sha256Hex, timingSafeEqual, uuid, now } from '../lib/ids'
import { hsDirectZone } from '../lib/certBroker'
import { getServerCert } from '../lib/db'

export const apps = new Hono<{ Bindings: Env }>()

const DEVICE_CODE_TTL = (env: Env) => Number(env.APP_DEVICE_CODE_TTL_SECONDS || '900')
/** RFC 8628 polling interval, in seconds, handed to the app and enforced. */
const POLL_INTERVAL = 5

async function requireUser(c: Context<{ Bindings: Env }>): Promise<ClerkIdentity | null> {
  const token = bearer(c.req.header('Authorization') ?? null)
  if (!token) return null
  try {
    return await verifyClerk(c.env, token)
  } catch (err) {
    if (err instanceof AuthError) return null
    throw err
  }
}

/** Authenticate an app by its client credentials. */
async function authApp(env: Env, appId: string, secret: string): Promise<AppRow | null> {
  if (!appId || !secret) return null
  const app = await getApp(env, appId)
  if (!app) return null
  const presented = await sha256Hex(secret)
  if (!timingSafeEqual(presented, app.secret_hash)) return null
  return app
}

function publicApp(a: AppRow) {
  return {
    app_id: a.app_id,
    name: a.name,
    kind: a.kind,
    family: a.family,
    homepage_url: a.homepage_url,
    requested_scopes: parseAppScopes(a.requested_scopes).scopes,
    listing_status: a.listing_status,
  }
}

// --- registration (RFC 7591) ----------------------------------------------

/**
 * Register an application.
 *
 * Two callers, deliberately one endpoint so an app author reads one spec:
 *
 *  - An INSTANCE app self-registers UNAUTHENTICATED on first boot. This is the
 *    Audplexus path and it must stay invisible to the user - forcing every
 *    self-hoster through a developer console before they can connect would be a
 *    terrible flow. It is safe because the resulting app can only ever be
 *    authorized by the account that later approves it, and because a bare
 *    registration reaches nothing.
 *
 *  - A CLOUD app is registered from the dev console with a Clerk session, so we
 *    know its developer.
 *
 * An instance registration records the owner as null-until-approved: the first
 * user to approve it becomes its owner (see /apps/approve), which is what binds
 * a running instance to the person running it.
 */
apps.post('/apps/register', async (c) => {
  let body: {
    name?: string
    kind?: string
    family?: string
    homepage_url?: string
    scopes?: string | string[]
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }

  const name = (body.name || '').trim()
  if (name.length < 2) return c.json({ error: 'invalid_name' }, 400)
  const kind = body.kind === 'cloud' ? 'cloud' : 'instance'
  const family = (body.family || '').trim().toLowerCase() || null
  const homepageUrl = (body.homepage_url || '').trim() || null

  const { scopes, unknown } = parseAppScopes(body.scopes)
  if (unknown.length) {
    return c.json({ error: 'invalid_scope', detail: `unknown scope: ${unknown[0]}` }, 400)
  }
  if (!scopes.length) return c.json({ error: 'invalid_scope', detail: 'no scopes requested' }, 400)

  // A cloud app must be registered by a signed-in developer - it is one
  // deployment serving many users, so it needs an accountable owner.
  let ownerId: string
  if (kind === 'cloud') {
    const user = await requireUser(c)
    if (!user) return c.json({ error: 'unauthorized', detail: 'cloud apps register signed in' }, 401)
    if (await registrationRateLimited(c.env, user.userId)) {
      return c.json({ error: 'rate_limited' }, 429)
    }
    ownerId = user.userId
  } else {
    // Instance self-registration. Unauthenticated by necessity: the app has no
    // Clerk session and its user has not opened a browser yet. Rate limited per
    // family+IP so mass-minting identities is not free.
    const ip = c.req.header('CF-Connecting-IP') || 'unknown'
    if (await registrationRateLimited(c.env, `family:${family ?? 'none'}|${ip}`)) {
      return c.json({ error: 'rate_limited' }, 429)
    }
    // Unclaimed until someone approves it. Written as a sentinel rather than
    // NULL so the NOT NULL constraint holds and an unclaimed app can never
    // accidentally match a real Clerk id.
    ownerId = `unclaimed:${uuid()}`
  }

  const { row, secret } = await createApp(c.env, {
    name,
    kind,
    family,
    homepageUrl,
    scopes,
    ownerClerkUserId: ownerId,
  })

  return c.json({
    app_id: row.app_id,
    // Shown exactly once. Never retrievable again - only rotatable.
    client_secret: secret,
    kind: row.kind,
    family: row.family,
    scopes,
    device_authorization_endpoint: `${c.env.CP_ISSUER}/apps/device/code`,
    token_endpoint: `${c.env.CP_ISSUER}/apps/device/token`,
  })
})

// --- device flow (RFC 8628) ------------------------------------------------

apps.post('/apps/device/code', async (c) => {
  let body: { app_id?: string; client_secret?: string; scopes?: string | string[] }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }

  const app = await authApp(c.env, (body.app_id || '').trim(), body.client_secret || '')
  if (!app) return c.json({ error: 'invalid_client' }, 401)

  // Requested scopes default to what the app registered for, and may never
  // exceed them - an app cannot quietly ask for more at runtime than its
  // registration (and, for a cloud app, its review) covered.
  const registered = parseAppScopes(app.requested_scopes).scopes
  const asked = body.scopes ? parseAppScopes(body.scopes) : { scopes: registered, unknown: [] }
  if (asked.unknown.length) {
    return c.json({ error: 'invalid_scope', detail: `unknown scope: ${asked.unknown[0]}` }, 400)
  }
  const excess = asked.scopes.filter((s) => !registered.includes(s))
  if (excess.length) {
    return c.json({ error: 'invalid_scope', detail: `not registered for: ${excess[0]}` }, 400)
  }

  c.executionCtx?.waitUntil?.(sweepDeviceCodes(c.env).catch(() => {}))

  const ttl = DEVICE_CODE_TTL(c.env)
  const row = await createDeviceCode(c.env, {
    appId: app.app_id,
    scopes: asked.scopes.length ? asked.scopes : registered,
    ttlSeconds: ttl,
  })

  // APP_ORIGINS is a comma-separated CORS allowlist (prod + previews); the FIRST
  // entry is the canonical user-facing origin, which is what a device-flow user
  // code must point at. Never hand out a preview origin here - the user is being
  // told where to go approve something.
  const appOrigin = (c.env.APP_ORIGINS || 'https://app.hearthshelf.com').split(',')[0].trim()
  const verificationUri = `${appOrigin}/connect`
  return c.json({
    device_code: row.device_code,
    user_code: row.user_code,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?code=${encodeURIComponent(row.user_code)}`,
    expires_in: ttl,
    interval: POLL_INTERVAL,
  })
})

/**
 * The poll. Error strings here are RFC 8628 wire format and MUST match the RFC
 * exactly - the entire point of following the standard is that an app author can
 * point a stock OAuth library at us and have it work.
 */
apps.post('/apps/device/token', async (c) => {
  let body: { app_id?: string; client_secret?: string; device_code?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }

  const app = await authApp(c.env, (body.app_id || '').trim(), body.client_secret || '')
  if (!app) return c.json({ error: 'invalid_client' }, 401)

  const row = await getDeviceCode(c.env, (body.device_code || '').trim())
  if (!row || row.app_id !== app.app_id) return c.json({ error: 'expired_token' }, 400)
  if (row.expires_at < now()) {
    await consumeDeviceCode(c.env, row.device_code)
    return c.json({ error: 'expired_token' }, 400)
  }

  // Interval enforcement. A client polling faster than it was told gets
  // slow_down rather than being served - cheap protection against a tight loop.
  if (row.last_polled_at && now() - row.last_polled_at < POLL_INTERVAL * 1000) {
    await touchDeviceCodePoll(c.env, row.device_code)
    return c.json({ error: 'slow_down' }, 400)
  }
  await touchDeviceCodePoll(c.env, row.device_code)

  if (row.status === 'pending') return c.json({ error: 'authorization_pending' }, 400)
  if (row.status === 'denied') {
    await consumeDeviceCode(c.env, row.device_code)
    return c.json({ error: 'access_denied' }, 400)
  }

  // Approved. Mint one introduction per approved server and spend the code.
  const clerkUserId = row.clerk_user_id as string
  const serverIds = (row.server_ids || '').split(',').filter(Boolean)
  const scopes = parseAppScopes(row.scopes).scopes

  const introductions = []
  for (const serverId of serverIds) {
    const link = await getLink(c.env, clerkUserId, serverId)
    const server = await getServer(c.env, serverId)
    // A server the user has since unlinked is silently dropped rather than
    // failing the whole approval - the app gets the servers still valid.
    if (!link || !server) continue

    const token = await mintAppIntroduction(c.env, {
      appId: app.app_id,
      appName: app.name,
      appKind: app.kind,
      family: app.family,
      clerkUserId,
      serverId,
      serverUrl: server.public_url,
      email: link.email,
      username: '',
      role: link.role,
      scopes,
    })

    // Hand over every address the app might use, most-preferred first. The LAN
    // address comes WITH its identity key or not at all: an app must be able to
    // authenticate a private origin before presenting a credential to it, and
    // an unverifiable address is worse than none.
    const cert = await getServerCert(c.env, serverId)
    const fallbackUrl =
      cert?.status === 'active' ? `https://${cert.hash}.${hsDirectZone(c.env)}` : undefined
    const local = await getServerLocalAddr(c.env, serverId)

    introductions.push({
      server_id: serverId,
      server_name: server.name,
      server_url: server.public_url,
      ...(fallbackUrl ? { fallback_url: fallbackUrl } : {}),
      ...(local?.local_url && local.identity_key
        ? { local_url: local.local_url, identity_key: local.identity_key }
        : {}),
      introduction_token: token,
    })
  }

  await upsertInstallation(c.env, {
    appId: app.app_id,
    clerkUserId,
    scopes,
    serverIds: introductions.map((i) => i.server_id),
  })
  await consumeDeviceCode(c.env, row.device_code)

  return c.json({ introductions, scopes: formatAppScopes(scopes) })
})

// --- consent (Clerk-authenticated) -----------------------------------------

/** What am I being asked to approve? Drives the consent screen. */
apps.get('/apps/pending/:userCode', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const code = normalizeUserCode(c.req.param('userCode'))
  if (!code) return c.json({ error: 'invalid_code' }, 400)
  const row = await getDeviceCodeByUserCode(c.env, code)
  if (!row) return c.json({ error: 'invalid_code' }, 404)
  if (row.expires_at < now()) return c.json({ error: 'code_expired' }, 410)
  if (row.status !== 'pending') return c.json({ error: 'code_already_used' }, 409)

  const app = await getApp(c.env, row.app_id)
  if (!app) return c.json({ error: 'invalid_code' }, 404)

  // THE OWNERSHIP GATE, checked here as well as at approve. A phisher drives the
  // victim to this lookup, so refusing here is what stops a lookalike app from
  // ever rendering a consent screen to someone who does not run it.
  if (!canUserAuthorize(app, user.userId)) {
    return c.json({ error: 'not_authorizable', detail: 'this app is not yours to connect' }, 403)
  }

  // Offer only servers the user is actually linked to.
  const links = await listLinksForUser(c.env, user.userId)
  return c.json({
    app: publicApp(app),
    scopes: parseAppScopes(row.scopes).scopes,
    // 'own_instance' vs 'store' is informational framing for the consent screen.
    // The security control is the gate above, not this label.
    relationship: app.owner_clerk_user_id === user.userId ? 'own_instance' : 'store',
    servers: links.map((l) => ({
      id: l.server_id,
      name: l.display_name || l.server_name || l.public_url,
      role: l.role,
    })),
  })
})

apps.post('/apps/approve', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  if (!user.emailVerified) return c.json({ error: 'email_unverified' }, 403)

  let body: { user_code?: string; server_ids?: string[]; scopes?: string[] }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }

  const code = normalizeUserCode(body.user_code || '')
  if (!code) return c.json({ error: 'invalid_code' }, 400)
  const row = await getDeviceCodeByUserCode(c.env, code)
  if (!row) return c.json({ error: 'invalid_code' }, 404)
  if (row.expires_at < now()) return c.json({ error: 'code_expired' }, 410)
  if (row.status !== 'pending') return c.json({ error: 'code_already_used' }, 409)

  const app = await getApp(c.env, row.app_id)
  if (!app) return c.json({ error: 'invalid_code' }, 404)
  if (!canUserAuthorize(app, user.userId)) {
    return c.json({ error: 'not_authorizable' }, 403)
  }

  // An authorization that reaches nothing is a false confirmation of access -
  // the user would believe they had connected something. Refuse it.
  const serverIds = (body.server_ids || []).filter((s) => typeof s === 'string' && s)
  if (!serverIds.length) return c.json({ error: 'no_servers_selected' }, 400)
  for (const serverId of serverIds) {
    const link = await getLink(c.env, user.userId, serverId)
    if (!link) return c.json({ error: 'not_linked', detail: serverId }, 403)
  }

  // The user may narrow what the app asked for, never widen it.
  const asked = parseAppScopes(row.scopes).scopes
  const granted: AppScope[] = body.scopes
    ? parseAppScopes(body.scopes).scopes.filter((s) => asked.includes(s))
    : asked
  if (!granted.length) return c.json({ error: 'no_scopes_granted' }, 400)

  // First approver of an unclaimed instance app becomes its owner. This is what
  // binds a running instance to the person running it, and it is why a second
  // user cannot later approve the same instance.
  if (app.owner_clerk_user_id.startsWith('unclaimed:')) {
    await c.env.DB.prepare(`UPDATE apps SET owner_clerk_user_id = ? WHERE app_id = ?`)
      .bind(user.userId, app.app_id)
      .run()
  }

  await approveDeviceCode(c.env, row.device_code, {
    clerkUserId: user.userId,
    serverIds,
    scopes: granted,
  })
  return c.json({ ok: true })
})

apps.post('/apps/deny', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  let body: { user_code?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const code = normalizeUserCode(body.user_code || '')
  if (!code) return c.json({ error: 'invalid_code' }, 400)
  const row = await getDeviceCodeByUserCode(c.env, code)
  if (!row) return c.json({ error: 'invalid_code' }, 404)

  const app = await getApp(c.env, row.app_id)
  if (!app || !canUserAuthorize(app, user.userId)) return c.json({ error: 'not_authorizable' }, 403)

  await denyDeviceCode(c.env, row.device_code)
  return c.json({ ok: true })
})

// --- developer console -----------------------------------------------------

apps.get('/apps/mine', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const rows = await listAppsForOwner(c.env, user.userId)
  return c.json({ apps: rows.map(publicApp) })
})

apps.post('/apps/mine', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  let body: { name?: string; kind?: string; homepage_url?: string; scopes?: string | string[] }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const name = (body.name || '').trim()
  if (name.length < 2) return c.json({ error: 'invalid_name' }, 400)
  const { scopes, unknown } = parseAppScopes(body.scopes)
  if (unknown.length) return c.json({ error: 'invalid_scope', detail: unknown[0] }, 400)
  if (!scopes.length) return c.json({ error: 'invalid_scope', detail: 'no scopes' }, 400)
  if (await registrationRateLimited(c.env, user.userId)) {
    return c.json({ error: 'rate_limited' }, 429)
  }

  const { row, secret } = await createApp(c.env, {
    name,
    kind: body.kind === 'cloud' ? 'cloud' : 'instance',
    family: null,
    homepageUrl: (body.homepage_url || '').trim() || null,
    scopes,
    ownerClerkUserId: user.userId,
  })
  return c.json({ app: publicApp(row), client_secret: secret })
})

/** Owner-only guard for the console mutations below. */
async function ownedApp(
  c: Context<{ Bindings: Env }>,
  user: ClerkIdentity,
  id: string,
): Promise<AppRow | null> {
  const app = await getApp(c.env, id)
  if (!app || app.owner_clerk_user_id !== user.userId) return null
  return app
}

apps.post('/apps/mine/:id/secret', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const app = await ownedApp(c, user, c.req.param('id'))
  if (!app) return c.json({ error: 'not_found' }, 404)
  const secret = await rotateAppSecret(c.env, app.app_id)
  return c.json({ ok: true, client_secret: secret })
})

apps.patch('/apps/mine/:id', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const app = await ownedApp(c, user, c.req.param('id'))
  if (!app) return c.json({ error: 'not_found' }, 404)

  let body: { scopes?: string | string[] }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const { scopes, unknown } = parseAppScopes(body.scopes)
  if (unknown.length) return c.json({ error: 'invalid_scope', detail: unknown[0] }, 400)
  if (!scopes.length) return c.json({ error: 'invalid_scope' }, 400)
  const status = await setRequestedScopes(c.env, app, scopes)
  return c.json({ ok: true, listing_status: status })
})

apps.delete('/apps/mine/:id', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const app = await ownedApp(c, user, c.req.param('id'))
  if (!app) return c.json({ error: 'not_found' }, 404)
  await deleteApp(c.env, app.app_id)
  return c.json({ ok: true })
})

/**
 * Submit for store review. Instance apps are refused: there is nothing to list
 * (it is software, not a service), and a listed instance app would mean one
 * shared secret inside a public binary reaching every user's library.
 */
apps.post('/apps/mine/:id/submit', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const app = await ownedApp(c, user, c.req.param('id'))
  if (!app) return c.json({ error: 'not_found' }, 404)
  if (app.kind !== 'cloud') {
    return c.json(
      { error: 'not_listable', detail: 'self-hosted apps are not listed; each user runs their own' },
      400,
    )
  }
  await setListingStatus(c.env, app.app_id, 'pending')
  return c.json({ ok: true, listing_status: 'pending' })
})

// --- store -----------------------------------------------------------------

apps.get('/apps/store', async (c) => {
  const rows = await listStoreApps(c.env)
  return c.json({ apps: rows.map(publicApp) })
})

// --- admin review ----------------------------------------------------------

apps.get('/apps/review/queue', async (c) => {
  const admin = await resolveAdmin(c)
  if (!admin) return c.json({ error: 'forbidden' }, 403)
  const rows = await listPendingReviewApps(c.env)
  return c.json({ apps: rows.map(publicApp) })
})

apps.post('/apps/review/:id', async (c) => {
  const admin = await resolveAdmin(c)
  if (!admin) return c.json({ error: 'forbidden' }, 403)

  let body: { action?: string; reason?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const app = await getApp(c.env, c.req.param('id'))
  if (!app) return c.json({ error: 'not_found' }, 404)

  const action = body.action
  const status =
    action === 'approve' ? 'listed' : action === 'reject' || action === 'unlist' ? 'unlisted' : null
  if (!status) return c.json({ error: 'invalid_action' }, 400)
  if (status === 'listed' && app.kind !== 'cloud') {
    return c.json({ error: 'not_listable' }, 400)
  }

  await setListingStatus(c.env, app.app_id, status, {
    reason: body.reason ?? null,
    reviewedBy: admin.user.userId,
  })
  await writeAudit(c.env, {
    id: uuid(),
    actor: admin.user.userId,
    action: `app_${action}`,
    target: app.app_id,
    detail: { name: app.name, reason: body.reason ?? null },
  })
  return c.json({ ok: true, listing_status: status })
})

// --- connections (mirror; the box is authoritative) ------------------------

apps.get('/apps/installations', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const rows = await listInstallationsForUser(c.env, user.userId)
  return c.json({
    installations: rows.map((r) => ({
      id: r.id,
      app_id: r.app_id,
      app_name: r.app_name,
      kind: r.kind,
      family: r.family,
      scopes: parseAppScopes(r.scopes).scopes,
      server_ids: r.server_ids,
      created_at: r.created_at,
      last_seen_at: r.last_seen_at,
    })),
    // The SPA must confirm against each box before presenting this as current.
    mirror: true,
  })
})

/**
 * Revoke an app, forwarding to every box it reaches.
 *
 * The box holds the credential, so OUR delete is bookkeeping. If a box cannot be
 * reached we report that plainly instead of claiming success: a user cutting off
 * a misbehaving app needs to know whether it actually stopped.
 */
apps.delete('/apps/installations/:id', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const install = await getInstallation(c.env, c.req.param('id'), user.userId)
  if (!install) return c.json({ error: 'not_found' }, 404)

  const serverIds = await installationServerIds(c.env, install.id)
  const failed: string[] = []
  for (const serverId of serverIds) {
    const ok = await forwardRevoke(c.env, serverId, install.app_id, user.userId)
    if (!ok) failed.push(serverId)
  }

  // Only forget the mirror row when every box confirmed. A half-revoked app that
  // vanished from the list would be invisible AND alive - the worst outcome.
  if (!failed.length) await deleteInstallation(c.env, install.id)

  return c.json({ ok: failed.length === 0, unreachable: failed })
})

apps.delete('/apps/installations/:id/servers/:serverId', async (c) => {
  const user = await requireUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const install = await getInstallation(c.env, c.req.param('id'), user.userId)
  if (!install) return c.json({ error: 'not_found' }, 404)
  const serverId = c.req.param('serverId')

  const ok = await forwardRevoke(c.env, serverId, install.app_id, user.userId)
  if (!ok) return c.json({ ok: false, unreachable: [serverId] }, 502)

  await removeInstallationServer(c.env, install.id, serverId)
  const left = await installationServerIds(c.env, install.id)
  if (!left.length) await deleteInstallation(c.env, install.id)
  return c.json({ ok: true })
})

/**
 * Tell a box to drop an app's credential. Server-to-server, authenticated by the
 * box's own server secret hash being unavailable to us - so instead we sign a
 * short revocation grant the box verifies against our JWKS, the same trust path
 * it already uses for introductions.
 *
 * Returns false on ANY failure. The caller must treat that as "not revoked".
 */
async function forwardRevoke(
  env: Env,
  serverId: string,
  appId: string,
  clerkUserId: string,
): Promise<boolean> {
  const server = await getServer(env, serverId)
  if (!server) return true // gone entirely - nothing to revoke

  try {
    const token = await mintAppIntroduction(env, {
      appId,
      appName: '',
      appKind: 'instance',
      family: null,
      clerkUserId,
      serverId,
      serverUrl: server.public_url,
      email: '',
      username: '',
      role: 'user',
      scopes: [],
    })
    const res = await fetch(`${server.public_url}/hs/apps/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revocation_token: token, app_id: appId }),
      signal: AbortSignal.timeout(8000),
    })
    return res.ok
  } catch {
    return false
  }
}
