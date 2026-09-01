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
      const res = await createAuth(env).handler(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(cors)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    return new Response('Not found', { status: 404, headers: cors })
  },
}
