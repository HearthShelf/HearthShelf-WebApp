-- Infra log sink (warn/error only). Holds operational logs from across the
-- HearthShelf hosted infrastructure so failures can be diagnosed without
-- hand-collecting logs from a VPS or asking self-hosters to paste them.
--
-- This database is DELIBERATELY separate from hearthshelf-control-plane: it is
-- fed in part by a public ingest endpoint the off-Cloudflare VPS broker reaches,
-- so it must not live next to the control plane's signing key or its data. No
-- ABS library data, tokens, or key material is ever written here.

CREATE TABLE IF NOT EXISTS infra_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Unix ms the event occurred (set by the collector on ingest, not the client,
  -- so a misconfigured clock on a box can't bury or future-date rows).
  ts         INTEGER NOT NULL,
  -- Where it came from: 'vps' (cert broker), 'cp' (control-plane Worker),
  -- 'box' (a self-hosted HearthShelf backend). Used by the admin filter.
  source     TEXT NOT NULL,
  -- 'warn' | 'error'. Anything below warn is rejected at the ingest layer, so
  -- this column is effectively those two values; kept open for future levels.
  severity   TEXT NOT NULL,
  -- Short machine event code, e.g. 'issuance_failed', 'token_rejected',
  -- 'cert_grant_failed'. Groupable; this is the primary "what happened" key.
  event      TEXT NOT NULL,
  -- The server this concerns, when known (the box/cert it relates to). Nullable
  -- for VPS-global events. NOT a foreign key - this DB has no servers table and
  -- must stay decoupled from the control-plane schema.
  server_id  TEXT,
  -- Human-readable message / error tail (truncated by the collector).
  message    TEXT,
  -- Optional structured context as a JSON string (status codes, host, acme tail).
  detail     TEXT,
  -- Source IP the ingest request came from (VPS path only; null for service-bind
  -- forwards). For abuse triage, not analytics.
  ip         TEXT,
  created_at INTEGER NOT NULL
);

-- The admin viewer filters/sorts by time, source, severity, and server.
CREATE INDEX IF NOT EXISTS idx_infra_logs_ts        ON infra_logs (ts DESC);
CREATE INDEX IF NOT EXISTS idx_infra_logs_source_ts ON infra_logs (source, ts DESC);
CREATE INDEX IF NOT EXISTS idx_infra_logs_sev_ts    ON infra_logs (severity, ts DESC);
CREATE INDEX IF NOT EXISTS idx_infra_logs_server_ts ON infra_logs (server_id, ts DESC);
