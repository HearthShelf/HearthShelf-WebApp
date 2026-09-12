/**
 * Control-plane side of infra logging. The CP never binds the logs DB; it talks
 * to the isolated log-collector Worker over the LOG_COLLECTOR service binding,
 * carrying the shared x-cp-forward token. Both forwarding (writes) and the admin
 * viewer (reads) go through here.
 *
 * Everything is best-effort for writes: logging must never break a request. If
 * the binding or token is missing (e.g. local dev), forwards quietly no-op.
 */
import type { Env } from '../types'

interface Dsn {
  origin: string
  projectId: string
  publicKey: string
}

/** Shape: `https://<publicKey>@<host>/<projectId>`. Null on anything malformed. */
function parseDsn(dsn: string | undefined | null): Dsn | null {
  if (!dsn) return null
  try {
    const url = new URL(dsn)
    const projectId = url.pathname.replace(/^\//, '').trim()
    if (!projectId || !url.username) return null
    return { origin: url.origin, projectId, publicKey: url.username }
  } catch {
    return null
  }
}

/** RFC4122-ish id without dashes, which is what the event schema wants. */
function eventId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface ForwardLog {
  // The CP forwards its own ('cp'), a box's ('box'), or a phone app's ('mobile')
  // logs - never 'vps' (that's the collector's direct VPS intake). A 'mobile'
  // report is relayed only after the CP authenticates the reporting Clerk user.
  source: 'cp' | 'box' | 'mobile'
  severity: 'warn' | 'error'
  event: string
  server_id?: string | null
  message?: string | null
  detail?: unknown
  /** The reporting Clerk user id, when known (mobile crash reports). Lets the
   *  account data-deletion flow purge this user's rows from the collector. */
  clerk_user_id?: string | null
}

/**
 * Fire-and-forget a warn/error to GlitchTip. Never throws.
 *
 * Reports go over Sentry's envelope format, spoken directly rather than through
 * an SDK: an envelope is three newline-delimited JSON objects, so an SDK would
 * cost bundle size and cold-start time in a Worker for no benefit.
 *
 * This replaces the old forward to the log-collector Worker. The collector is
 * still READ by the admin viewer below, so the binding stays until that page
 * moves to GlitchTip too - but nothing writes to it from here any more.
 */
export async function forwardLog(env: Env, rec: ForwardLog): Promise<void> {
  const dsn = parseDsn(env.GLITCHTIP_DSN)
  if (!dsn) return

  const id = eventId()
  const sentAt = new Date().toISOString()
  const payload = {
    event_id: id,
    timestamp: sentAt,
    platform: 'javascript',
    level: rec.severity === 'warn' ? 'warning' : 'error',
    logger: 'control-plane',
    environment: 'production',
    message: { formatted: rec.message || rec.event },
    // `source` distinguishes the control plane's own faults from a box's or a
    // phone's relayed report; `server_id` is how the fleet is filtered. Both
    // are low-cardinality, which is what tags are for.
    tags: {
      service: 'control-plane',
      source: rec.source,
      event: rec.event,
      ...(rec.server_id ? { server_id: rec.server_id } : {}),
    },
    // Group by source+event, not the message: a message carrying a path or a
    // status code would otherwise split one fault across many issues.
    fingerprint: ['control-plane', rec.source, rec.event],
    ...(rec.detail ? { extra: { detail: rec.detail } } : {}),
    exception: { values: [{ type: 'Error', value: rec.message || rec.event }] },
  }

  const body = [
    JSON.stringify({ event_id: id, sent_at: sentAt }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(payload),
  ].join('\n')

  try {
    await fetch(`${dsn.origin}/api/${dsn.projectId}/envelope/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=hearthshelf/1.0`,
      },
      body,
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // best-effort; swallow
  }
}

/** Proxy the admin viewer's read to the collector's /logs. Returns the parsed
 *  JSON body, or null if the collector is unreachable/unconfigured. */
export async function readLogs(env: Env, query: string): Promise<unknown | null> {
  if (!env.LOG_COLLECTOR || !env.LOG_INGEST_TOKEN) return null
  try {
    const res = await env.LOG_COLLECTOR.fetch(`https://collector/logs?${query}`, {
      headers: { 'x-cp-forward': env.LOG_INGEST_TOKEN },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** Result of a delete proxy: rows removed, or null if the collector is
 *  unreachable/unconfigured (so the caller can surface a 503 vs a false 0). */
export interface DeleteResult {
  deleted: number
}

/** Delete one log row by id via the collector. Returns null if unreachable. */
export async function deleteLog(env: Env, id: number): Promise<DeleteResult | null> {
  if (!env.LOG_COLLECTOR || !env.LOG_INGEST_TOKEN) return null
  try {
    const res = await env.LOG_COLLECTOR.fetch(`https://collector/logs/${id}`, {
      method: 'DELETE',
      headers: { 'x-cp-forward': env.LOG_INGEST_TOKEN },
    })
    if (!res.ok) return null
    return (await res.json()) as DeleteResult
  } catch {
    return null
  }
}

/** Bulk-delete logs (optionally filtered) via the collector. `query` is the
 *  already-built source/severity/server_id querystring; empty clears all. */
export async function deleteLogs(env: Env, query: string): Promise<DeleteResult | null> {
  if (!env.LOG_COLLECTOR || !env.LOG_INGEST_TOKEN) return null
  try {
    const res = await env.LOG_COLLECTOR.fetch(`https://collector/logs${query ? `?${query}` : ''}`, {
      method: 'DELETE',
      headers: { 'x-cp-forward': env.LOG_INGEST_TOKEN },
    })
    if (!res.ok) return null
    return (await res.json()) as DeleteResult
  } catch {
    return null
  }
}

/** Delete every log row attributed to a Clerk user (their crash reports). Used
 *  by the account data-deletion flow. Returns null if the collector is
 *  unreachable/unconfigured, so the caller can decide how to treat that. */
export async function deleteLogsByUser(
  env: Env,
  clerkUserId: string,
): Promise<DeleteResult | null> {
  if (!env.LOG_COLLECTOR || !env.LOG_INGEST_TOKEN) return null
  try {
    const res = await env.LOG_COLLECTOR.fetch(
      `https://collector/logs/by-user/${encodeURIComponent(clerkUserId)}`,
      {
        method: 'DELETE',
        headers: { 'x-cp-forward': env.LOG_INGEST_TOKEN },
      },
    )
    if (!res.ok) return null
    return (await res.json()) as DeleteResult
  } catch {
    return null
  }
}
