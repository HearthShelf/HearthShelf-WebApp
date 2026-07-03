/**
 * Anonymous, opt-in usage telemetry + the public aggregate stats it feeds.
 *
 *   POST /telemetry/report   a box (that has opted in) sends bucketed, anonymous
 *                            counts. NOT server_secret authed - deliberately not
 *                            correlated to the paired identity. Keyed by a random
 *                            per-install telemetry_id the box chooses.
 *   GET  /stats/public       aggregate-only rollup for hearthshelf.com/stats. Never
 *                            returns a single install's row.
 *
 * Design mirrors Home Assistant's analytics: off by default, transparent about
 * exactly what is sent, and only ever surfaced as fleet-wide aggregates.
 */
import { Hono } from 'hono'
import type { Env } from '../types'
import { ingestTelemetry, getPublicStats, type TelemetryInput } from '../lib/telemetry'

export const telemetry = new Hono<{ Bindings: Env }>()

telemetry.post('/telemetry/report', async (c) => {
  let body: TelemetryInput
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const ok = await ingestTelemetry(c.env, body)
  if (!ok) return c.json({ error: 'invalid_payload' }, 400)
  return c.json({ ok: true })
})

telemetry.get('/stats/public', async (c) => {
  const stats = await getPublicStats(c.env)
  return c.json(stats)
})
