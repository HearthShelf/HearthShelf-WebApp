/**
 * Error reporting for the auth service.
 *
 * Reports to the self-hosted GlitchTip instance over Sentry's envelope format,
 * spoken directly rather than through an SDK. An envelope is three
 * newline-delimited JSON objects, so an SDK would cost bundle size and
 * cold-start time in a Worker for no benefit - and `@sentry/cloudflare` against
 * a self-hosted DSN is not something we could verify from documentation,
 * whereas the envelope contract is implemented in GlitchTip's own source.
 *
 * This mirrors `@hearthshelf/core`'s telemetryEnvelope.ts. It is duplicated
 * rather than imported because this Worker is standalone with no core path
 * alias (same reason src/identity.ts declares its own types) - adding the
 * submodule to this build for one file would couple them.
 *
 * WHY THIS EXISTS. This Worker had no error reporting at all, which meant a
 * fatal startup failure - the schema self-check D1 refuses, which 500'd every
 * single request - was invisible unless somebody happened to be running
 * `wrangler tail` at that moment. The first signal was a user saying sign-in
 * did not work.
 *
 * Everything here is best-effort: reporting must never be what breaks a
 * request. An unset or malformed DSN quietly no-ops, so local dev needs no
 * setup, and a report can never be the reason a sign-in fails.
 */
import type { Env } from './types'

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

interface AuthLog {
  severity: 'warn' | 'error'
  /** Short stable slug for the failure, e.g. 'session_verify_failed'. It is the
   *  fingerprint, so one recurring fault stays one issue rather than thousands. */
  event: string
  message?: string | null
  detail?: unknown
}

/** Fire-and-forget a warn/error to GlitchTip. Never throws. */
export async function reportError(env: Env, rec: AuthLog): Promise<void> {
  const dsn = parseDsn(env.GLITCHTIP_DSN)
  if (!dsn) return

  const id = eventId()
  const sentAt = new Date().toISOString()
  const payload = {
    event_id: id,
    timestamp: sentAt,
    platform: 'javascript',
    level: rec.severity === 'warn' ? 'warning' : 'error',
    logger: 'auth-service',
    environment: 'production',
    message: { formatted: rec.message || rec.event },
    tags: { service: 'auth-service', event: rec.event },
    // Group by the event slug, not the message: a message carrying a path or a
    // status code would otherwise split one fault across many issues.
    fingerprint: ['auth-service', rec.event],
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
    // Best-effort; swallow. A failed report must never surface to the caller.
  }
}

/**
 * Turn an unknown thrown value into something worth storing.
 *
 * Stack included because the failures worth catching here are startup and
 * configuration faults, where the throw site is the whole answer. Truncated so
 * one pathological error cannot fill the issue.
 */
export function describeError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message.slice(0, 500), stack: err.stack?.slice(0, 2000) }
  }
  return { message: String(err).slice(0, 500) }
}
