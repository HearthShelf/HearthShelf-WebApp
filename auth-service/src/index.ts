/**
 * HearthShelf auth service (auth.hearthshelf.com).
 *
 * Better Auth mounted at /api/auth/*, plus a health probe. Everything else
 * 404s: this Worker is an identity surface, not a general API.
 *
 * CORS is credentialed and the allowlist is PINNED to TRUSTED_ORIGINS - the
 * origin is echoed only when it appears there, never reflected. A wildcard
 * would let any site drive a signed-in user's browser against this service.
 */
import { createAuth } from './auth'
import { describeError, reportError } from './logs'
import type { Env } from './types'

function allowed(env: Env): string[] {
  return (env.TRUSTED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  if (!origin) return {}
  const normalized = origin.replace(/\/$/, '')
  if (!allowed(env).includes(normalized)) return {}
  return {
    'Access-Control-Allow-Origin': normalized,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    // Without this the browser hides `set-auth-token` from page JS on a
    // cross-origin response, so the app can never read the session token it
    // needs for the control plane - every call then 401s and looks like an
    // expired session. The bearer plugin sets this header itself on the
    // responses it stamps; we must not clobber it (see below).
    'Access-Control-Expose-Headers': 'set-auth-token',
    Vary: 'Origin',
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const cors = corsHeaders(env, req.headers.get('Origin'))

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', ...cors },
      })
    }

    if (url.pathname.startsWith('/api/auth/')) {
      let res: Response
      try {
        const auth = await createAuth(env)
        res = await auth.handler(req)
      } catch (err) {
        // A throw here is a startup or configuration fault, not a bad request:
        // it fails EVERY call, not one. Reported rather than left to a 1101 in
        // the dashboard that nobody is watching.
        const { message, stack } = describeError(err)
        await reportError(env, {
          severity: 'error',
          event: 'auth_handler_threw',
          message,
          detail: { path: url.pathname, stack },
        })
        return new Response(JSON.stringify({ error: 'auth_unavailable' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...cors },
        })
      }

      // A 5xx from the handler itself is equally invisible otherwise. 4xx is
      // ordinary traffic (a wrong code, an expired link) and stays unreported.
      if (res.status >= 500) {
        await reportError(env, {
          severity: 'error',
          event: 'auth_handler_5xx',
          message: `${res.status} on ${url.pathname}`,
          detail: { path: url.pathname, status: res.status },
        })
      }

      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(cors)) {
        // Merge rather than overwrite: the bearer plugin adds its own
        // Access-Control-Expose-Headers, and replacing it would hide the very
        // token header it just set.
        if (k === 'Access-Control-Expose-Headers') {
          const existing = headers.get(k)
          const merged = new Set(
            `${existing ?? ''},${v}`
              .split(',')
              .map((h) => h.trim())
              .filter(Boolean),
          )
          headers.set(k, [...merged].join(', '))
          continue
        }
        headers.set(k, v)
      }
      return new Response(res.body, { status: res.status, headers })
    }

    // A person who lands on this host is lost - it is an identity API with no
    // pages of its own, and a bare 404 reads as "HearthShelf is down". Send them
    // to the app instead. Only browser navigations: an API client hitting a
    // wrong path still gets an honest 404 rather than a confusing redirect.
    if (req.method === 'GET' && (req.headers.get('Accept') ?? '').includes('text/html')) {
      const appOrigin = allowed(env)[0] ?? 'https://app.hearthshelf.com'
      return Response.redirect(appOrigin, 302)
    }

    return new Response('Not found', { status: 404, headers: cors })
  },
}
