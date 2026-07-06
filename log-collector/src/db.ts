/** All D1 access for the log collector lives here. */
import type { Env, IncomingLog, LogSource } from './types'

/** A stored log row as returned to the admin viewer. */
export interface LogRow {
  id: number
  ts: number
  source: string
  severity: string
  event: string
  server_id: string | null
  message: string | null
  detail: string | null
  ip: string | null
}

const MESSAGE_MAX = 2000
const DETAIL_MAX = 8000

/**
 * Insert one validated log row. ts/created_at are stamped by the collector (not
 * the client) so a bad clock on a box can't bury or future-date rows. Returns
 * nothing; ingest is fire-and-forget from the caller's perspective.
 */
export async function insertLog(
  env: Env,
  rec: IncomingLog,
  ip: string | null,
  nowMs: number,
): Promise<void> {
  const detailStr =
    rec.detail == null
      ? null
      : (typeof rec.detail === 'string' ? rec.detail : safeJson(rec.detail)).slice(0, DETAIL_MAX)
  await env.LOGS_DB.prepare(
    `INSERT INTO infra_logs (ts, source, severity, event, server_id, message, detail, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      nowMs,
      rec.source,
      rec.severity,
      rec.event.slice(0, 200),
      rec.server_id ? rec.server_id.slice(0, 128) : null,
      rec.message ? rec.message.slice(0, MESSAGE_MAX) : null,
      detailStr,
      ip ? ip.slice(0, 64) : null,
      nowMs,
    )
    .run()
}

/** Filters the admin viewer can apply. All optional. */
export interface LogQuery {
  source?: LogSource
  severity?: string
  server_id?: string
  /** Only rows with ts >= sinceMs. */
  sinceMs?: number
  limit: number
  /** Keyset paging: only rows with id < beforeId (older than the last seen). */
  beforeId?: number
}

/** Read recent logs newest-first, with optional filters and keyset paging. */
export async function queryLogs(env: Env, q: LogQuery): Promise<LogRow[]> {
  const where: string[] = []
  const args: unknown[] = []
  if (q.source) {
    where.push('source = ?')
    args.push(q.source)
  }
  if (q.severity) {
    where.push('severity = ?')
    args.push(q.severity)
  }
  if (q.server_id) {
    where.push('server_id = ?')
    args.push(q.server_id)
  }
  if (q.sinceMs) {
    where.push('ts >= ?')
    args.push(q.sinceMs)
  }
  if (q.beforeId) {
    where.push('id < ?')
    args.push(q.beforeId)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  args.push(q.limit)
  const res = await env.LOGS_DB.prepare(
    `SELECT id, ts, source, severity, event, server_id, message, detail, ip
       FROM infra_logs ${clause}
       ORDER BY id DESC
       LIMIT ?`,
  )
    .bind(...args)
    .all<LogRow>()
  return res.results ?? []
}

/**
 * Delete rows older than the retention window. Called opportunistically after a
 * write (cheap; an index on ts makes the range delete fast). Best-effort.
 */
export async function sweepOldLogs(env: Env, nowMs: number): Promise<void> {
  const days = Number(env.LOG_RETENTION_DAYS || '30')
  const cutoff = nowMs - days * 24 * 60 * 60 * 1000
  await env.LOGS_DB.prepare(`DELETE FROM infra_logs WHERE ts < ?`).bind(cutoff).run()
}

/** Delete a single log row by id. Returns the number of rows removed (0 or 1). */
export async function deleteLog(env: Env, id: number): Promise<number> {
  const res = await env.LOGS_DB.prepare(`DELETE FROM infra_logs WHERE id = ?`).bind(id).run()
  return res.meta?.changes ?? 0
}

/** Filters for a bulk delete. Mirrors the query filters so "clear" honors the
 *  admin's active source/severity/server view. An empty filter deletes ALL rows. */
export interface LogDeleteFilter {
  source?: LogSource
  severity?: string
  server_id?: string
}

/**
 * Delete rows matching the given filters. With no filters this truncates the
 * whole table. Returns the number of rows deleted so the UI can confirm the
 * scope of what it just cleared.
 */
export async function deleteLogs(env: Env, f: LogDeleteFilter): Promise<number> {
  const where: string[] = []
  const args: unknown[] = []
  if (f.source) {
    where.push('source = ?')
    args.push(f.source)
  }
  if (f.severity) {
    where.push('severity = ?')
    args.push(f.severity)
  }
  if (f.server_id) {
    where.push('server_id = ?')
    args.push(f.server_id)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const res = await env.LOGS_DB.prepare(`DELETE FROM infra_logs ${clause}`)
    .bind(...args)
    .run()
  return res.meta?.changes ?? 0
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
