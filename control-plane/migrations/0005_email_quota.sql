-- Per-server email send metering for the hosted relay.
--
-- A paired box (or a Worker cron) sends through POST /email/send; we count
-- every successful send here, bucketed by a rolling monthly window, and enforce
-- a soft cap before handing off to Resend. One row per (server, window) so the
-- table stays tiny and a window reset is just a new row.
CREATE TABLE IF NOT EXISTS email_quota (
  server_id   TEXT    NOT NULL,
  -- Window start as a unix epoch (seconds). We bucket by calendar month at
  -- write time; the value is the first instant of that UTC month.
  window_start INTEGER NOT NULL,
  -- Count of emails accepted for sending in this window.
  sent        INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (server_id, window_start)
);

CREATE INDEX IF NOT EXISTS idx_email_quota_server ON email_quota (server_id);
