/**
 * Error reporting for the auth service.
 *
 * Forwards warn/error records to the isolated log-collector Worker over the
 * LOG_COLLECTOR service binding, exactly as the control plane does (see
 * ../../control-plane/src/lib/logs.ts). Reusing that path rather than adding a
 * crash-reporting SDK keeps this Worker's dependency surface at zero and puts
 * auth failures in the same viewer as everything else.
 *
 * WHY THIS EXISTS. This Worker had no error reporting at all, which meant a
 * fatal startup failure - the schema self-check D1 refuses, which 500'd every
 * single request - was invisible unless somebody happened to be running
 * `wrangler tail` at that moment. The first signal was a user saying sign-in
 * did not work.
 *
 * Everything here is best-effort: reporting must never be what breaks a
 * request. A missing binding or token quietly no-ops, so local dev needs no
 * setup.
 */
import type { Env } from './types'

interface AuthLog {
  severity: 'warn' | 'error'
  /** Short stable slug for the failure, e.g. 'session_verify_failed'. */
  event: string
  message?: string | null
  detail?: unknown
}

/** Fire-and-forget a warn/error to the collector. Never throws. */
export async function reportError(env: Env, rec: AuthLog): Promise<void> {
  if (!env.LOG_COLLECTOR || !env.LOG_INGEST_TOKEN) return
  try {
    await env.LOG_COLLECTOR.fetch('https://collector/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cp-forward': env.LOG_INGEST_TOKEN,
      },
      body: JSON.stringify({ source: 'cp', ...rec }),
    })
  } catch {
    // Best-effort; swallow. A failed log must never surface to the caller.
  }
}

/**
 * Turn an unknown thrown value into something worth storing.
 *
 * Stack included because the failures worth catching here are startup and
 * configuration faults, where the throw site is the whole answer. Truncated so
 * one pathological error cannot fill the log database.
 */
export function describeError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message.slice(0, 500), stack: err.stack?.slice(0, 2000) }
  }
  return { message: String(err).slice(0, 500) }
}
