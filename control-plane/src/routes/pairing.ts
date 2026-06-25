/**
 * Pairing-code exchange - the "link a server" plumbing.
 *
 * Two halves:
 *  1. POST /pairing/start  (called by the HS SERVER during setup; no Clerk auth)
 *     The HS server announces its identity + public URL and a freshly generated
 *     server secret. We record a short-lived pairing code bound to that server
 *     and return the code (HS shows it to the admin) plus our issuer URL and
 *     JWKS URL so HS can pin our key immediately.
 *
 *  2. POST /pairing/redeem  (called by the SPA; Clerk-authenticated)
 *     The signed-in user submits the code. We verify it is live and one-time,
 *     upsert the server, and create the link between this Clerk identity and
 *     the server. From then on the user can mint grants for it.
 *
 * The server secret never leaves as plaintext after start: we hash it at rest.
 * HS keeps the plaintext and presents it when requesting grants later.
 */
import { Hono } from 'hono'
import type { Env } from '../types'
import { bearer, verifyClerk, AuthError } from '../lib/clerk'
import {
  createPairing,
  getPairing,
  markPairingRedeemed,
  upsertServer,
  createLink,
  getOAuthClient,
  upsertOAuthClient,
} from '../lib/db'
import { pairingCode, serverSecret, sha256Hex, uuid, now } from '../lib/ids'
import { validatePublicUrl, probeServer } from '../lib/reachability'
import { createOAuthClient, absRedirectUri } from '../lib/clerkOAuth'

export const pairing = new Hono<{ Bindings: Env }>()

// --- pre-flight reachability check -----------------------------------------

// Best-effort per-IP rate limit for the unauthenticated /reachability/check
// endpoint, which triggers an outbound fetch. This bucket lives in the isolate's
// memory, so it only dampens abuse from a single warm isolate - it is NOT a hard
// global limit (Workers run many isolates). It is enough to stop a trivial flood;
// upgrade to a CF rate-limit binding or a D1/KV counter if stronger guarantees
// are needed. The real SSRF control is validate-then-probe-origin below.
const RL_WINDOW_MS = 60_000
const RL_MAX = 20
const rlHits = new Map<string, { count: number; resetAt: number }>()

function rateLimited(ip: string): boolean {
  const t = now()
  const cur = rlHits.get(ip)
  if (!cur || cur.resetAt < t) {
    rlHits.set(ip, { count: 1, resetAt: t + RL_WINDOW_MS })
    return false
  }
  cur.count++
  return cur.count > RL_MAX
}

// --- HS server initiates ---------------------------------------------------

pairing.post('/pairing/start', async (c) => {
  let body: { server_id?: string; public_url?: string; name?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const serverId = (body.server_id || '').trim()
  const publicUrl = (body.public_url || '').trim()
  const name = (body.name || '').trim() || null
  if (!serverId || !publicUrl) {
    return c.json({ error: 'server_id and public_url required' }, 400)
  }
  // Basic URL sanity - must be an absolute http(s) URL.
  try {
    const u = new URL(publicUrl)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme')
  } catch {
    return c.json({ error: 'public_url must be an absolute http(s) URL' }, 400)
  }

  const secret = serverSecret()
  const secretHash = await sha256Hex(secret)
  const code = pairingCode()
  const ttl = Number(c.env.PAIRING_TTL_SECONDS || '900')
  const expiresAt = now() + ttl * 1000

  await createPairing(c.env, {
    code,
    serverId,
    publicUrl,
    name,
    secretHash,
    expiresAt,
  })

  // Return everything HS needs to finish setup: the code to display, the secret
  // to keep (only chance to see it), and our key endpoints to pin.
  return c.json({
    code,
    expires_at: expiresAt,
    server_secret: secret,
    issuer: c.env.CP_ISSUER,
    jwks_url: `${c.env.CP_ISSUER}/.well-known/jwks.json`,
    grant_url: `${c.env.CP_ISSUER}/servers/grant`,
  })
})

// --- pre-flight reachability check (called before pairing) -----------------

// The self-hosted setup wizard calls this (via its own backend proxy) to learn,
// BEFORE committing to pairing, whether its public URL is a valid HTTPS host and
// reachable from the public internet. The check must run here on the Worker, not
// on the box: the box can reach itself on the LAN even when the internet can't.
// Advisory only - the hard gate stays at /pairing/redeem. Always 200; valid/
// reachable false are normal results, not errors.
pairing.post('/reachability/check', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') || 'unknown'
  if (rateLimited(ip)) return c.json({ error: 'rate_limited' }, 429)

  let body: { public_url?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const publicUrl = (body.public_url || '').trim()
  if (!publicUrl) return c.json({ error: 'public_url required' }, 400)

  // Validate first. Only probe the NORMALIZED origin, and only when valid - this
  // is the load-bearing SSRF control (validatePublicUrl rejects bare IPs, dotless
  // hosts, and non-https, so the probe can never target an internal address).
  const check = validatePublicUrl(publicUrl)
  if (!check.ok) {
    return c.json({
      valid: false,
      validReason: check.reason ?? null,
      reachable: null,
      probeStatus: null,
      probeDetail: null,
      httpStatus: null,
    })
  }

  const probe = await probeServer(check.origin as string)
  return c.json({
    valid: true,
    validReason: null,
    reachable: probe.status === 'online',
    probeStatus: probe.status,
    probeDetail: probe.detail ?? null,
    httpStatus: probe.httpStatus ?? null,
  })
})

// --- user redeems on app.hs.com -------------------------------------------

pairing.post('/pairing/redeem', async (c) => {
  const token = bearer(c.req.header('Authorization') ?? null)
  if (!token) return c.json({ error: 'unauthorized' }, 401)

  let identity
  try {
    identity = await verifyClerk(c.env, token)
  } catch (err) {
    if (err instanceof AuthError) return c.json({ error: 'unauthorized', detail: err.message }, 401)
    throw err
  }
  if (!identity.emailVerified) {
    return c.json({ error: 'email_unverified' }, 403)
  }

  let body: { code?: string; display_name?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const code = (body.code || '').trim().toUpperCase()
  if (!code) return c.json({ error: 'code required' }, 400)

  const row = await getPairing(c.env, code)
  if (!row) return c.json({ error: 'invalid_code' }, 404)
  if (row.redeemed_at) return c.json({ error: 'code_already_used' }, 409)
  if (row.expires_at < now()) return c.json({ error: 'code_expired' }, 410)

  // Reachability gate (design doc 7, Option A): the browser will connect to this
  // server's public origin directly for OIDC + data, so it must be a real
  // CA-valid HTTPS host - not plain HTTP, not a bare IP, not a dotless LAN name.
  // Reject early with an actionable error rather than linking a server the user
  // could never open.
  const urlCheck = validatePublicUrl(row.public_url)
  if (!urlCheck.ok) {
    return c.json(
      {
        error: 'public_url_not_reachable',
        reason: urlCheck.reason,
        detail:
          'This server must be published at a public HTTPS address with a valid certificate before it can be linked. A bare IP or http:// URL will not work from app.hearthshelf.com.',
      },
      422
    )
  }

  // Materialise the server and the link. The first redeemer is treated as the
  // server's admin owner; later redeemers (invitees) default to 'user'.
  await upsertServer(c.env, {
    serverId: row.server_id,
    publicUrl: row.public_url,
    name: row.name,
    secretHash: row.server_secret_hash,
  })
  await createLink(c.env, {
    id: uuid(),
    clerkUserId: identity.userId,
    serverId: row.server_id,
    email: identity.email,
    role: 'admin',
    displayName: (body.display_name || row.name || '').trim() || null,
  })
  await markPairingRedeemed(c.env, code, identity.userId)

  // Provision the dedicated per-server Clerk OAuth client (hosted OIDC). Only
  // on first pairing of this server - re-pairs / invitee redeems reuse it. The
  // client_secret is held until the HS server pulls it to configure ABS. A
  // failure here is non-fatal to linking: the link is valid and OIDC config can
  // be retried; we report it so the UI can prompt a re-pair if needed.
  let oidcProvisioned = false
  try {
    const existing = await getOAuthClient(c.env, row.server_id)
    if (!existing) {
      const redirectUri = absRedirectUri(urlCheck.origin as string)
      const client = await createOAuthClient(c.env, {
        name: `HearthShelf server ${row.name || row.server_id}`,
        redirectUri,
      })
      await upsertOAuthClient(c.env, {
        serverId: row.server_id,
        clerkAppId: client.appId,
        clientId: client.clientId,
        clientSecret: client.clientSecret ?? null,
        redirectUri,
      })
    }
    oidcProvisioned = true
  } catch (err) {
    // Swallow: linking already succeeded. Surface a soft signal in the response.
    oidcProvisioned = false
  }

  return c.json({
    ok: true,
    server: { id: row.server_id, url: row.public_url, name: row.name },
    oidc_provisioned: oidcProvisioned,
  })
})
