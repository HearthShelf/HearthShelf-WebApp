/**
 * HearthShelf control plane - Cloudflare Worker entry.
 *
 * Routes:
 *   GET  /.well-known/jwks.json   public signing keys (HS verifies grants)
 *   POST /pairing/start           HS server begins pairing (server-to-server)
 *   POST /pairing/redeem          user links a server (Clerk-authenticated)
 *   GET  /servers                 user's linked servers (Clerk)
 *   POST /servers/:id/grant       mint a short-TTL grant (Clerk)
 *   DELETE /servers/:id           unlink (Clerk)
 *   GET  /health                  liveness
 *
 * See ../ARCHITECTURE.md for the trust model and why the control plane is never
 * in the data path.
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types'
import { wellKnown } from './routes/well-known'
import { pairing } from './routes/pairing'
import { servers } from './routes/servers'
import { email } from './routes/email'
import { logs } from './routes/logs'
import { admin } from './routes/admin'
import { forwardLog } from './lib/logs'

const app = new Hono<{ Bindings: Env }>()

// The SPA (app.hearthshelf.com) calls this API with the Clerk bearer token.
// Allow only the configured app origin(s); never reflect arbitrary origins.
// APP_ORIGINS is a comma-separated allowlist (prod + any preview/localhost);
// defaults to the production app. Server-to-server endpoints (pairing/start,
// invite-from-server, oidc-config) don't rely on CORS and are unaffected.
app.use('*', (c, next) => {
  const allowed = (c.env.APP_ORIGINS || 'https://app.hearthshelf.com')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean)
  return cors({
    origin: (origin) => (origin && allowed.includes(origin.replace(/\/$/, '')) ? origin : null),
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 86400,
  })(c, next)
})

app.get('/health', (c) => c.json({ ok: true }))

app.route('/', wellKnown)
app.route('/', pairing)
app.route('/', servers)
app.route('/', email)
app.route('/', logs)
app.route('/', admin)

app.notFound((c) => c.json({ error: 'not_found' }, 404))
app.onError((err, c) => {
  console.error('[control-plane] error:', err)
  // Forward the CP's own unhandled errors to the central collector (best-effort).
  c.executionCtx?.waitUntil(
    forwardLog(c.env, {
      source: 'cp',
      severity: 'error',
      event: 'cp_unhandled_error',
      message: String(err).slice(0, 500),
      detail: { path: new URL(c.req.url).pathname, method: c.req.method },
    }),
  )
  return c.json({ error: 'server_error', detail: String(err).slice(0, 160) }, 500)
})

export default app
