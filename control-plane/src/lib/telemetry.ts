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

const USER_BUCKETS = ['1', '2-5', '6-20', '21+']
const BOOK_BUCKETS = ['0', '1-99', '100-999', '1000+']
const MODES = ['slim', 'aio']

export interface TelemetryInput {
  telemetry_id?: unknown
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

  await env.DB.prepare(
    `INSERT INTO telemetry_reports
       (telemetry_id, hs_version, abs_version, mode, user_bucket, book_bucket,
        quests_given, quests_accepted, books_finished, club_books_finished,
        clubs_active, reported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (telemetry_id) DO UPDATE SET
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
       reported_at = excluded.reported_at`,
  )
    .bind(
      id,
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
      now(),
    )
    .run()

  // Opportunistic prune of long-dead rows (cheap; keeps active counts honest).
  await env.DB.prepare(`DELETE FROM telemetry_reports WHERE reported_at < ?`)
    .bind(now() - PRUNE_AFTER_MS)
    .run()

  return true
}

export interface PublicStats {
  active_installs: number
  version_distribution: Record<string, number>
  totals: {
    quests_given: number
    quests_accepted: number
    books_finished: number
    club_books_finished: number
  }
}

/** Aggregate-only rollup for hearthshelf.com/stats. Counts installs seen in the
 *  active window and SUMs their lifetime counters. Never returns a raw row. */
export async function getPublicStats(env: Env): Promise<PublicStats> {
  const cutoff = now() - ACTIVE_WINDOW_MS

  const totals = await env.DB.prepare(
    `SELECT
        COUNT(*) AS installs,
        COALESCE(SUM(quests_given), 0) AS quests_given,
        COALESCE(SUM(quests_accepted), 0) AS quests_accepted,
        COALESCE(SUM(books_finished), 0) AS books_finished,
        COALESCE(SUM(club_books_finished), 0) AS club_books_finished
      FROM telemetry_reports WHERE reported_at >= ?`,
  )
    .bind(cutoff)
    .first<{
      installs: number
      quests_given: number
      quests_accepted: number
      books_finished: number
      club_books_finished: number
    }>()

  const dist = await env.DB.prepare(
    `SELECT hs_version AS version, COUNT(*) AS n
       FROM telemetry_reports
      WHERE reported_at >= ? AND hs_version IS NOT NULL
      GROUP BY hs_version
      ORDER BY n DESC`,
  )
    .bind(cutoff)
    .all<{ version: string; n: number }>()

  const version_distribution: Record<string, number> = {}
  for (const row of dist.results ?? []) version_distribution[row.version] = row.n

  return {
    active_installs: totals?.installs ?? 0,
    version_distribution,
    totals: {
      quests_given: totals?.quests_given ?? 0,
      quests_accepted: totals?.quests_accepted ?? 0,
      books_finished: totals?.books_finished ?? 0,
      club_books_finished: totals?.club_books_finished ?? 0,
    },
  }
}
