/**
 * HearthShelf log collector - an isolated Cloudflare Worker that ingests
 * warn/error infra logs into a dedicated D1 database (hearthshelf-logs).
 *
 * Why a separate Worker: one of its ingest paths is reachable by the VPS cert
 * broker, which lives OUTSIDE Cloudflare on the public internet. Keeping that
 * surface out of the control-plane isolate means a flaw here can't reach the
 * control plane's signing key, Clerk secret, or its database. This Worker holds
 * exactly one binding (LOGS_DB) and one secret (LOG_INGEST_TOKEN).
 *
 * Routes:
 *   POST /ingest/vps   public, Bearer LOG_INGEST_TOKEN - the VPS broker. source
 *                      is FORCED to 'vps' (a token holder cannot forge cp/box).
 *   POST /ingest       internal, called by the control plane over a SERVICE
 *                      BINDING with the x-cp-forward header. Accepts cp/box logs
 *                      the CP already authenticated upstream.
 *   GET  /logs         internal (same x-cp-forward gate) - the CP admin route
 *                      proxies here to serve the admin viewer. Read-only.
 *   GET  /health       liveness.
 *
 * Severity below LOG_MIN_SEVERITY (default 'warn') is dropped at the door, so the
 * DB never accumulates info/debug noise.
 */
import { Hono } from 'hono'
import type { Env, IncomingLog, LogSource } from './types'
import { SEVERITY_RANK } from './types'
import { insertLog, queryLogs, sweepOldLogs, type LogQuery } from './db'

const app = new Hono<{ Bindings: Env }>()

const VALID_SOURCES: LogSource[] = ['vps', 'cp', 'box']

app.get('/health', (c) => c.json({ ok: true }))

// --- VPS intake: public, bearer-authed, source forced to 'vps' ---------------
app.post('/ingest/vps', async (c) => {
  const auth = c.req.header('Authorization') || ''
  const expected = c.env.LOG_INGEST_TOKEN
  if (!expected || !auth.startsWith('Bearer ') || !timingSafeEq(auth.slice(7), expected)) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'bad_body' }, 400)
  }
  // A VPS token can only write 'vps' logs - never forge a cp/box source.
  const rec = normalize(body, 'vps')
  if (!rec) return c.json({ error: 'invalid_log' }, 422)
  if (!passesSeverity(c.env, rec.severity)) return c.json({ ok: true, dropped: 'below_severity' })

  const ip = c.req.header('CF-Connecting-IP') || null
  await store(c.env, rec, ip)
  return c.json({ ok: true })
})

// --- Internal intake: service binding from the control plane only ------------
app.post('/ingest', async (c) => {
  if (!internalOk(c)) return c.json({ error: 'unauthorized' }, 401)
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'bad_body' }, 400)
  }
  // The CP forwards already-classified logs; honor the body source if valid
  // (cp/box), else reject. The CP is trusted here (it's behind the binding).
  const rawSource = (body as { source?: string })?.source
  if (!rawSource || !VALID_SOURCES.includes(rawSource as LogSource)) {
    return c.json({ error: 'bad_source' }, 422)
  }
  const rec = normalize(body, rawSource as LogSource)
  if (!rec) return c.json({ error: 'invalid_log' }, 422)
  if (!passesSeverity(c.env, rec.severity)) return c.json({ ok: true, dropped: 'below_severity' })

  await store(c.env, rec, null)
  return c.json({ ok: true })
})

// --- Internal read: the CP admin route proxies here --------------------------
app.get('/logs', async (c) => {
  if (!internalOk(c)) return c.json({ error: 'unauthorized' }, 401)
  const u = new URL(c.req.url)
  const limit = clampInt(u.searchParams.get('limit'), 1, 200, 100)
  const q: LogQuery = { limit }
  const source = u.searchParams.get('source')
  if (source && VALID_SOURCES.includes(source as LogSource)) q.source = source as LogSource
  const severity = u.searchParams.get('severity')
  if (severity) q.severity = severity
  const serverId = u.searchParams.get('server_id')
  if (serverId) q.server_id = serverId
  const since = u.searchParams.get('since')
  if (since) {
    const n = Number(since)
    if (Number.isFinite(n) && n > 0) q.sinceMs = n
  }
  const before = u.searchParams.get('before_id')
  if (before) {
    const n = Number(before)
    if (Number.isFinite(n) && n > 0) q.beforeId = n
  }
  const rows = await queryLogs(c.env, q)
  return c.json({ logs: rows })
})

app.notFound((c) => c.json({ error: 'not_found' }, 404))
app.onError((err, c) => {
  console.error('[log-collector] error:', err)
  return c.json({ error: 'server_error' }, 500)
})

export default app

// --- helpers -----------------------------------------------------------------

/**
 * Internal calls (from the control plane over the service binding) carry the
 * x-cp-forward header equal to LOG_INGEST_TOKEN. We reuse the one secret: the CP
 * is configured with it, and only Workers we bind can reach this without it being
 * a public bearer. A request lacking the header is rejected even if it reached
 * the public hostname.
 */
function internalOk(c: { req: { header: (k: string) => string | undefined }; env: Env }): boolean {
  const tok = c.req.header('x-cp-forward')
  return !!tok && !!c.env.LOG_INGEST_TOKEN && timingSafeEq(tok, c.env.LOG_INGEST_TOKEN)
}

async function store(env: Env, rec: IncomingLog, ip: string | null): Promise<void> {
  const now = Date.now()
  await insertLog(env, rec, ip, now)
  // Opportunistic retention sweep - cheap with the ts index, best-effort.
  await sweepOldLogs(env, now).catch(() => {})
}

function passesSeverity(env: Env, severity: string): boolean {
  const min = SEVERITY_RANK[(env.LOG_MIN_SEVERITY || 'warn').toLowerCase()] ?? SEVERITY_RANK.warn
  const got = SEVERITY_RANK[severity.toLowerCase()] ?? 0
  return got >= min
}

/** Validate + coerce an incoming body into a stored record, or null if unusable. */
function normalize(body: unknown, source: LogSource): IncomingLog | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const severity = typeof b.severity === 'string' ? b.severity.toLowerCase() : ''
  const event = typeof b.event === 'string' ? b.event.trim() : ''
  if (!severity || !event) return null
  if (!(severity in SEVERITY_RANK)) return null
  return {
    source,
    severity,
    event,
    server_id: typeof b.server_id === 'string' ? b.server_id : null,
    message: typeof b.message === 'string' ? b.message : null,
    detail: b.detail ?? null,
  }
}

function clampInt(v: string | null, min: number, max: number, dflt: number): number {
  const n = v == null ? NaN : Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

/** Constant-time string compare to avoid leaking the token via timing. */
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
