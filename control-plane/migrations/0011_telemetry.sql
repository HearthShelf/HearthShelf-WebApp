-- Anonymous, opt-in usage telemetry (Home Assistant style).
--
-- A box the admin has opted in posts bucketed, non-identifying counts here,
-- keyed by a RANDOM per-install telemetry_id it chooses itself. We deliberately
-- do NOT store the server_id or server_secret alongside it, so a telemetry row
-- cannot be tied back to a paired identity. Last write wins per telemetry_id.
--
-- Nothing here identifies a person, a title, a library, or a network address -
-- only coarse buckets and lifetime counters. The only consumer is the aggregate
-- rollup at GET /stats/public (hearthshelf.com/stats); a single row is never
-- exposed.

CREATE TABLE IF NOT EXISTS telemetry_reports (
  telemetry_id        TEXT PRIMARY KEY,   -- random, box-chosen; not a server_id
  hs_version          TEXT,
  abs_version         TEXT,
  mode                TEXT,               -- 'slim' | 'aio'
  user_bucket         TEXT,               -- '1' | '2-5' | '6-20' | '21+'
  book_bucket         TEXT,               -- '0' | '1-99' | '100-999' | '1000+'
  quests_given        INTEGER,
  quests_accepted     INTEGER,
  books_finished      INTEGER,
  club_books_finished INTEGER,
  clubs_active        INTEGER,
  reported_at         INTEGER NOT NULL
);

-- Rollups scan by recency (active installs = seen within a window) and group by
-- version, so index the report time.
CREATE INDEX IF NOT EXISTS idx_telemetry_reported ON telemetry_reports (reported_at);
