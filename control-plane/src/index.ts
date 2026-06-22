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

const app = new Hono<{ Bindings: Env }>()

// The SPA (app.hearthshelf.com) calls this API with the Clerk bearer token.
// Allow the app origin; pairing/start is server-to-server and unaffected by CORS.
app.use(
  '*',
  cors({
    origin: (origin) => origin, // reflect; tighten to the app origin in prod vars
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 86400,
  })
)

app.get('/health', (c) => c.json({ ok: true }))

app.route('/', wellKnown)
app.route('/', pairing)
app.route('/', servers)

app.notFound((c) => c.json({ error: 'not_found' }, 404))
app.onError((err, c) => {
  console.error('[control-plane] error:', err)
  return c.json({ error: 'server_error', detail: String(err).slice(0, 160) }, 500)
})

export default app
