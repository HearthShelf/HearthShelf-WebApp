/**
 * HTTP wiring for the "sign in this device" email flow. The state machine and
 * its reasoning live in ./linkSignIn.ts; this file binds it to Better Auth's
 * verification table, its magic link endpoint and our mail.
 *
 *   POST /hs/link-sign-in/start    { email, callbackURL }       requesting device
 *   POST /hs/link-sign-in/poll     { requestId, pollSecret }    requesting device
 *   POST /hs/link-sign-in/info     { requestId, approveSecret } approval page
 *   POST /hs/link-sign-in/approve  { requestId, approveSecret } approval page
 *   POST /hs/link-sign-in/deny     { requestId, approveSecret } approval page
 *   POST /hs/link-sign-in/here     { requestId, approveSecret } approval page
 *
 * Never log a body here: every one carries a secret.
 */
import { createAuth, deviceName, type MagicLinkCapture } from './auth'
import { sendMail, templates } from './email'
import * as flow from './linkSignIn'
import { describeError, reportError } from './logs'
import type { Env } from './types'

function webOrigins(env: Env): string[] {
  return (env.TRUSTED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

function coarseLocation(req: Request): string | undefined {
  const cf = req.cf as Record<string, unknown> | undefined
  const parts = [cf?.city, cf?.country].filter(
    (v): v is string => typeof v === 'string' && Boolean(v),
  )
  return parts.length ? parts.join(', ') : undefined
}

/**
 * Polls arrive every couple of seconds per waiting screen. The poll secret
 * already makes guessing pointless, so this only stops one client hammering
 * D1. Per isolate, which is enough for that.
 */
const lastPoll = new Map<string, number>()
function pollTooSoon(requestId: string): boolean {
  const now = Date.now()
  const last = lastPoll.get(requestId)
  if (last && now - last < 1000) return true
  lastPoll.set(requestId, now)
  if (lastPoll.size > 5000) {
    for (const [k, t] of lastPoll) if (now - t > 60_000) lastPoll.delete(k)
  }
  return false
}

async function buildDeps(env: Env): Promise<flow.LinkDeps> {
  const capture: MagicLinkCapture = { email: '' }
  const auth = await createAuth(env, { captureMagicLink: capture })
  const ctx = await auth.$context

  const store: flow.LinkStore = {
    async create(identifier, value, expiresAt) {
      await ctx.internalAdapter.createVerificationValue({ identifier, value, expiresAt })
    },
    async find(identifier) {
      const row = await ctx.internalAdapter.findVerificationValue(identifier)
      return row ? { value: row.value, expiresAt: new Date(row.expiresAt) } : null
    },
    async consume(identifier) {
      const row = await ctx.internalAdapter.consumeVerificationValue(identifier)
      return row ? { value: row.value, expiresAt: new Date(row.expiresAt) } : null
    },
    count: (identifier) =>
      ctx.adapter.count({
        model: 'verification',
        where: [{ field: 'identifier', value: identifier }],
      }),
  }

  return {
    store,
    allowedOrigins: webOrigins(env),
    async mint(email, callbackURL) {
      // Better Auth's own magic link endpoint, called server-side: it creates
      // the token row exactly as for an ordinary link, and this instance's
      // sendMagicLink hands us the URL instead of mailing it.
      capture.email = email
      capture.url = undefined
      await auth.api.signInMagicLink({ body: { email, callbackURL }, headers: new Headers() })
      const url = capture.url
      capture.email = ''
      capture.url = undefined
      if (!url) throw new Error('magic link was not captured')
      return url
    },
    async mailApproval(email, approveUrl, details) {
      await sendMail({
        apiKey: env.RESEND_API_KEY,
        from: env.EMAIL_FROM,
        to: email,
        ...templates.linkApproval(approveUrl, details),
      })
    },
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function reply<T extends object>(result: flow.Result<T>): Response {
  if (!result.ok) return json({ error: result.error }, result.status)
  const { ok: _ok, ...body } = result
  return json(body)
}

export async function handleLinkSignIn(req: Request, env: Env, action: string): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  // Browser-only flow: the asking page must be our web app.
  const origin = (req.headers.get('Origin') || '').replace(/\/$/, '')
  if (!webOrigins(env).includes(origin)) return json({ error: 'forbidden' }, 403)

  let body: Record<string, unknown>
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object')
    body = parsed as Record<string, unknown>
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }

  try {
    const deps = await buildDeps(env)
    switch (action) {
      case 'start':
        return reply(
          await flow.start(deps, {
            email: body.email,
            callbackURL: body.callbackURL,
            device: deviceName(req),
            location: coarseLocation(req),
            ip: req.headers.get('cf-connecting-ip') || undefined,
          }),
        )
      case 'poll':
        if (typeof body.requestId === 'string' && pollTooSoon(body.requestId)) {
          return json({ error: 'too_many_requests' }, 429)
        }
        return reply(await flow.poll(deps, body.requestId, body.pollSecret))
      case 'info':
        return reply(await flow.info(deps, body.requestId, body.approveSecret))
      case 'approve':
        return reply(await flow.approve(deps, body.requestId, body.approveSecret))
      case 'deny':
        return reply(await flow.deny(deps, body.requestId, body.approveSecret))
      case 'here':
        return reply(await flow.signInHere(deps, body.requestId, body.approveSecret))
      default:
        return json({ error: 'not_found' }, 404)
    }
  } catch (err) {
    const { message, stack } = describeError(err)
    await reportError(env, {
      severity: 'error',
      event: 'link_sign_in_failed',
      message,
      detail: { action, stack },
    })
    return json({ error: 'unavailable' }, 500)
  }
}
