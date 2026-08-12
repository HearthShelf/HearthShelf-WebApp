/**
 * Anonymous telemetry ingest + public aggregation.
 *
 * The box sends coarse buckets + lifetime counters keyed by a random per-install
 * telemetry_id. We validate the shape, clamp the numbers, and upsert (last write
 * wins). The only thing we ever hand back out is the aggregate rollup - individual
 * rows never leave the database.
 *
 * "Active installs" counts telemetry_ids seen within ACTIVE_WINDOW_MS; rows older
 * than PRUNE_AFTER_MS are swept so the public counts reflect live installs, not a
 * pile of one-time reports from boxes that later opted out or went away.
 */
import type { Env } from '../types'
import { now } from './ids'

const ACTIVE_WINDOW_MS = 60 * 24 * 60 * 60 * 1000 // 60 days
const PRUNE_AFTER_MS = 90 * 24 * 60 * 60 * 1000 // 90 days
const DAY_MS = 24 * 60 * 60 * 1000
// How many days of history the installs-over-time chart shows.
const TREND_DAYS = 30

const USER_BUCKETS = ['1', '2-5', '6-20', '21+']
const BOOK_BUCKETS = ['0', '1-99', '100-999', '1000+']
const MODES = ['slim', 'aio']
// Mirrors HSInstallPlatform / HSInstallDeviceType in @hearthshelf/core. Kept
// local because the Worker deliberately does not depend on core (its wire types
// live here); these MUST stay structurally in sync with the core definitions.
const PLATFORMS = ['ios', 'android', 'docker', 'windows-service']
const DEVICE_TYPES = ['phone', 'tablet', 'desktop', 'server']

// Which platforms are servers vs end-user apps. Version stats are reported
// separately for each: a server admin wants to know how many boxes are behind,
// which is a different question from how many phones are on an old app build.
const SERVER_PLATFORMS = ['docker', 'windows-service']

// Simulators and emulators are development artifacts, not community installs.
// They otherwise dominate the device chart during active development (a CI
// runner or a rebuilt simulator reports like a real phone). Matched on the
// device model, which is what those environments report verbatim.
const DEV_MODEL_RE = /simulator|emulator|sdk[ _]?built|generic|virtual|google_sdk|android sdk/i

/** True when a report is from a simulator/emulator rather than a real install. */
export function isDevInstall(deviceModel: string | null | undefined): boolean {
  return typeof deviceModel === 'string' && DEV_MODEL_RE.test(deviceModel)
}

export interface TelemetryInput {
  telemetry_id?: unknown
  // Unified install fields (mobile + server). See core HSInstallReport.
  platform?: unknown
  device_model?: unknown
  device_type?: unknown
  os_name?: unknown
  os_version?: unknown
  app_version?: unknown
  // Server-only usage fields.
  hs_version?: unknown
  abs_version?: unknown
  mode?: unknown
  user_bucket?: unknown
  book_bucket?: unknown
  quests_given?: unknown
  quests_accepted?: unknown
  books_finished?: unknown
  club_books_finished?: unknown
  clubs_active?: unknown
}

function str(v: unknown, max = 40): string | null {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null
}
function oneOf(v: unknown, allowed: string[]): string | null {
  return typeof v === 'string' && allowed.includes(v) ? v : null
}
function count(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < 0) return 0
  // Clamp to a sane ceiling so a bad client can't skew the SUMs.
  return Math.min(Math.floor(n), 100_000_000)
}

/** Validate + store one report. Returns false if the telemetry_id is missing or
 *  malformed (the one field we require to be a stable, opaque handle). */
export async function ingestTelemetry(env: Env, input: TelemetryInput): Promise<boolean> {
  const id = str(input.telemetry_id, 64)
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) return false

  const deviceModel = str(input.device_model, 60)

  await env.DB.prepare(
    `INSERT INTO telemetry_reports
       (telemetry_id, platform, device_model, device_type, os_name, os_version,
        app_version, hs_version, abs_version, mode, user_bucket, book_bucket,
        quests_given, quests_accepted, books_finished, club_books_finished,
        clubs_active, is_dev, reported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (telemetry_id) DO UPDATE SET
       platform = excluded.platform,
       device_model = excluded.device_model,
       device_type = excluded.device_type,
       os_name = excluded.os_name,
       os_version = excluded.os_version,
       app_version = excluded.app_version,
       hs_version = excluded.hs_version,
       abs_version = excluded.abs_version,
       mode = excluded.mode,
       user_bucket = excluded.user_bucket,
       book_bucket = excluded.book_bucket,
       quests_given = excluded.quests_given,
       quests_accepted = excluded.quests_accepted,
       books_finished = excluded.books_finished,
       club_books_finished = excluded.club_books_finished,
       clubs_active = excluded.clubs_active,
       is_dev = excluded.is_dev,
       reported_at = excluded.reported_at`,
  )
    .bind(
      id,
      oneOf(input.platform, PLATFORMS),
      deviceModel,
      oneOf(input.device_type, DEVICE_TYPES),
      str(input.os_name, 30),
      str(input.os_version, 30),
      str(input.app_version, 40),
      str(input.hs_version),
      str(input.abs_version),
      oneOf(input.mode, MODES),
      oneOf(input.user_bucket, USER_BUCKETS),
      oneOf(input.book_bucket, BOOK_BUCKETS),
      count(input.quests_given),
      count(input.quests_accepted),
      count(input.books_finished),
      count(input.club_books_finished),
      count(input.clubs_active),
      isDevInstall(deviceModel) ? 1 : 0,
      now(),
    )
    .run()

  // Opportunistic prune of long-dead rows (cheap; keeps active counts honest).
  await env.DB.prepare(`DELETE FROM telemetry_reports WHERE reported_at < ?`)
    .bind(now() - PRUNE_AFTER_MS)
    .run()

  return true
}

/** One day in the installs-over-time series. `day` is UTC-midnight epoch ms. */
export interface TrendPoint {
  day: number
  count: number
}

/** Aggregate-only public rollup. Mirrors HSPublicStats in @hearthshelf/core. */
export interface PublicStats {
  active_installs: number
  installs_by_platform: Record<string, number>
  /** Servers and apps pooled. Kept for consumers that render a single list. */
  version_distribution: Record<string, number>
  /** HearthShelf versions across self-hosted servers only (docker, service). */
  server_version_distribution: Record<string, number>
  /** App versions across the mobile apps only. */
  app_version_distribution: Record<string, number>
  device_model_distribution: Record<string, number>
  /** Servers by install shape: 'slim' (bring your own ABS) vs 'aio' (bundled). */
  server_mode_distribution: Record<string, number>
  installs_over_time: TrendPoint[]
  latest_version: string | null
  /** Newest version seen across servers - the "are boxes behind" reference. */
  latest_server_version: string | null
  totals: {
    quests_given: number
    quests_accepted: number
    books_finished: number
    club_books_finished: number
  }
}

/** Highest semver-ish version string. Compares dotted numeric parts, ignoring any
 *  pre-release tail so '0.0.10' > '0.0.2' and '0.0.10-R2' still sorts as 0.0.10.
 *  Pure display helper - a tie or unparseable pair falls back to string order. */
function newerVersion(a: string, b: string): string {
  const parts = (v: string) =>
    v
      .replace(/-.*$/, '')
      .split('.')
      .map((n) => parseInt(n, 10) || 0)
  const pa = parts(a)
  const pb = parts(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da > db ? a : b
  }
  return a >= b ? a : b
}

/**
 * Aggregate-only rollup for the public stats dashboard. Counts installs seen in
 * the active window, split by platform, with version + device-model distributions
 * and a daily installs-over-time trend. SUMs server usage counters. Never returns
 * a raw row - only fleet-wide aggregates leave the database.
 */
export async function getPublicStats(env: Env): Promise<PublicStats> {
  const cutoff = now() - ACTIVE_WINDOW_MS

  // Every query below excludes is_dev rows: simulators and emulators are
  // development artifacts, and while HearthShelf is young they outnumber real
  // installs badly enough to make the whole page misleading.
  const totals = await env.DB.prepare(
    `SELECT
        COUNT(*) AS installs,
        COALESCE(SUM(quests_given), 0) AS quests_given,
        COALESCE(SUM(quests_accepted), 0) AS quests_accepted,
        COALESCE(SUM(books_finished), 0) AS books_finished,
        COALESCE(SUM(club_books_finished), 0) AS club_books_finished
      FROM telemetry_reports WHERE reported_at >= ? AND is_dev = 0`,
  )
    .bind(cutoff)
    .first<{
      installs: number
      quests_given: number
      quests_accepted: number
      books_finished: number
      club_books_finished: number
    }>()

  // Active installs per platform. Rows predating 0014 were backfilled to 'docker'.
  const byPlatform = await env.DB.prepare(
    `SELECT COALESCE(platform, 'docker') AS platform, COUNT(*) AS n
       FROM telemetry_reports
      WHERE reported_at >= ? AND is_dev = 0
      GROUP BY COALESCE(platform, 'docker')`,
  )
    .bind(cutoff)
    .all<{ platform: string; n: number }>()

  const installs_by_platform: Record<string, number> = {}
  for (const row of byPlatform.results ?? []) installs_by_platform[row.platform] = row.n

  // Version distribution, split by what the version MEANS. Pooling them answered
  // no useful question: "v0.2.0 - 5 installs" could not tell a server admin
  // whether any box was behind, because phone app builds were mixed in. Servers
  // report hs_version; apps report app_version.
  const serverList = SERVER_PLATFORMS.map(() => '?').join(',')
  const serverDist = await env.DB.prepare(
    `SELECT COALESCE(hs_version, app_version) AS version, COUNT(*) AS n
       FROM telemetry_reports
      WHERE reported_at >= ? AND is_dev = 0
        AND COALESCE(platform, 'docker') IN (${serverList})
        AND COALESCE(hs_version, app_version) IS NOT NULL
      GROUP BY version
      ORDER BY n DESC`,
  )
    .bind(cutoff, ...SERVER_PLATFORMS)
    .all<{ version: string; n: number }>()

  const appDist = await env.DB.prepare(
    `SELECT COALESCE(app_version, hs_version) AS version, COUNT(*) AS n
       FROM telemetry_reports
      WHERE reported_at >= ? AND is_dev = 0
        AND COALESCE(platform, 'docker') NOT IN (${serverList})
        AND COALESCE(app_version, hs_version) IS NOT NULL
      GROUP BY version
      ORDER BY n DESC`,
  )
    .bind(cutoff, ...SERVER_PLATFORMS)
    .all<{ version: string; n: number }>()

  const server_version_distribution: Record<string, number> = {}
  let latest_server_version: string | null = null
  for (const row of serverDist.results ?? []) {
    server_version_distribution[row.version] = row.n
    latest_server_version = latest_server_version
      ? newerVersion(latest_server_version, row.version)
      : row.version
  }

  const app_version_distribution: Record<string, number> = {}
  for (const row of appDist.results ?? []) app_version_distribution[row.version] = row.n

  // Combined view kept for existing consumers (the marketing page still renders
  // one list when it has nothing more specific to show).
  const version_distribution: Record<string, number> = { ...app_version_distribution }
  for (const [v, n] of Object.entries(server_version_distribution)) {
    version_distribution[v] = (version_distribution[v] ?? 0) + n
  }
  let latest_version: string | null = null
  for (const v of Object.keys(version_distribution)) {
    latest_version = latest_version ? newerVersion(latest_version, v) : v
  }

  // Device-model distribution - mobile only (servers report no model).
  const models = await env.DB.prepare(
    `SELECT device_model AS model, COUNT(*) AS n
       FROM telemetry_reports
      WHERE reported_at >= ? AND is_dev = 0 AND device_model IS NOT NULL
      GROUP BY device_model
      ORDER BY n DESC`,
  )
    .bind(cutoff)
    .all<{ model: string; n: number }>()

  const device_model_distribution: Record<string, number> = {}
  for (const row of models.results ?? []) device_model_distribution[row.model] = row.n

  // Slim vs all-in-one. Servers have reported `mode` since the first telemetry
  // build, but nothing ever aggregated it - so the one thing that says whether
  // self-hosters bring their own AudiobookShelf or use the bundled one never
  // reached the stats page. Servers only: a mobile row has no mode.
  const modes = await env.DB.prepare(
    `SELECT mode, COUNT(*) AS n
       FROM telemetry_reports
      WHERE reported_at >= ? AND is_dev = 0 AND mode IS NOT NULL
      GROUP BY mode
      ORDER BY n DESC`,
  )
    .bind(cutoff)
    .all<{ mode: string; n: number }>()

  const server_mode_distribution: Record<string, number> = {}
  for (const row of modes.results ?? []) server_mode_distribution[row.mode] = row.n

  // Installs-over-time: active install count per UTC day for the last TREND_DAYS.
  // "Active on day D" = last reported at any time up to and including D, so the
  // series shows the live fleet size over time, not just the day a report landed.
  const nowMs = now()
  const todayMidnight = Math.floor(nowMs / DAY_MS) * DAY_MS
  const installs_over_time: TrendPoint[] = []
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const dayStart = todayMidnight - i * DAY_MS
    const dayEnd = dayStart + DAY_MS
    // Active as of this day = reported within the active window ending that day.
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM telemetry_reports
        WHERE reported_at < ? AND reported_at >= ? AND is_dev = 0`,
    )
      .bind(dayEnd, dayEnd - ACTIVE_WINDOW_MS)
      .first<{ n: number }>()
    installs_over_time.push({ day: dayStart, count: row?.n ?? 0 })
  }

  return {
    active_installs: totals?.installs ?? 0,
    installs_by_platform,
    version_distribution,
    server_version_distribution,
    app_version_distribution,
    device_model_distribution,
    server_mode_distribution,
    installs_over_time,
    latest_version,
    latest_server_version,
    totals: {
      quests_given: totals?.quests_given ?? 0,
      quests_accepted: totals?.quests_accepted ?? 0,
      books_finished: totals?.books_finished ?? 0,
      club_books_finished: totals?.club_books_finished ?? 0,
    },
  }
}
