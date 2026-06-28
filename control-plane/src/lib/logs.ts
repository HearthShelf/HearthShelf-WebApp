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

export interface ForwardLog {
  // The CP only ever forwards its own ('cp') or a box's ('box') logs - never
  // 'vps' (that's the collector's direct VPS intake).
  source: 'cp' | 'box'
  severity: 'warn' | 'error'
  event: string
  server_id?: string | null
  message?: string | null
  detail?: unknown
}

/** Fire-and-forget a warn/error log to the collector. Never throws. */
export async function forwardLog(env: Env, rec: ForwardLog): Promise<void> {
  if (!env.LOG_COLLECTOR || !env.LOG_INGEST_TOKEN) return
  try {
    await env.LOG_COLLECTOR.fetch('https://collector/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cp-forward': env.LOG_INGEST_TOKEN,
      },
      body: JSON.stringify(rec),
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

/** Is this verified email a platform operator? Allowlist from PLATFORM_ADMIN_EMAILS
 *  (comma-separated, case-insensitive). Empty list = nobody (locked by default). */
export function isPlatformAdmin(env: Env, email: string): boolean {
  const allow = (env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return !!email && allow.includes(email.toLowerCase())
}
