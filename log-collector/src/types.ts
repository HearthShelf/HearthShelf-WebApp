/** Bindings + env for the isolated log-collector Worker. */
export interface Env {
  /** The ONLY binding this Worker holds: the dedicated logs database. */
  LOGS_DB: D1Database

  // vars (wrangler.toml [vars])
  /** Minimum accepted severity; below this is dropped. 'warn' by default. */
  LOG_MIN_SEVERITY?: string
  /** Days to retain rows before the opportunistic sweep deletes them. */
  LOG_RETENTION_DAYS?: string

  // secrets (wrangler secret put)
  /** Bearer token the VPS broker presents on POST /ingest/vps. Only credential. */
  LOG_INGEST_TOKEN: string
}

/** Allowed sources. Kept small + explicit; the ingest layer rejects others.
 *  'mobile' is a crash/breadcrumb report from the phone app, forwarded by the
 *  control plane after it authenticates the reporting Clerk user. Device/OS/app
 *  fields and the JS breadcrumb trail ride in the `detail` JSON. */
export type LogSource = 'vps' | 'cp' | 'box' | 'mobile'

/** Severity ordering for the min-severity gate. */
export const SEVERITY_RANK: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

/** One log record as accepted by ingest (client-supplied fields). */
export interface IncomingLog {
  source: LogSource
  severity: string
  event: string
  server_id?: string | null
  message?: string | null
  /** Arbitrary structured context; serialized to a JSON string on store. */
  detail?: unknown
}
