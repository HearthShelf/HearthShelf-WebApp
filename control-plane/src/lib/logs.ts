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
