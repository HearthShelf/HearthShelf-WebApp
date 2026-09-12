/**
 * Control-plane side of infra logging. The CP never binds the logs DB; it talks
 * to the self-hosted GlitchTip instance.
 *
 * Everything is best-effort: logging must never break a request. An unset or
 * malformed DSN quietly no-ops, which is a valid local-dev state.
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
  // The CP reports its own faults ('cp'), a box's ('box'), or a phone app's
  // ('mobile'). A 'mobile' report is relayed only after the CP authenticates
  // the reporting user.
  source: 'cp' | 'box' | 'mobile'
  severity: 'warn' | 'error'
  event: string
  server_id?: string | null
  message?: string | null
  detail?: unknown
  /** The reporting user id, when known (mobile crash reports). */
  clerk_user_id?: string | null
}

/**
 * Fire-and-forget a warn/error to GlitchTip. Never throws.
 *
 * Reports go over Sentry's envelope format, spoken directly rather than through
 * an SDK: an envelope is three newline-delimited JSON objects, so an SDK would
 * cost bundle size and cold-start time in a Worker for no benefit.
 *
 * This replaces the old forward to the log-collector Worker, which has been
 * retired along with the admin log viewer that read it.
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
