-- Widen anonymous telemetry into a unified install/heartbeat record so mobile app
-- installs report alongside self-hosted servers, feeding one public dashboard.
--
-- Still anonymous: telemetry_id remains a random, client-chosen handle with no
-- link to a user, server, or address. The new columns are coarse hardware facts
-- (platform, device model/type, OS) that only ever surface as aggregates on the
-- public stats page - a single row is never exposed. See lib/telemetry.ts.
--
-- `platform` discriminates the install kind:
--   'ios' | 'android'          - mobile app
--   'docker'                   - self-hosted server (the only server kind today)
--   'windows-service'          - reserved for the future native server build
--
-- `app_version` is the unified version string across kinds (the mobile release
-- tag, or the server hs_version). hs_version/abs_version stay for the server-only
-- usage rollup; app_version is what the cross-platform version chart groups on.

ALTER TABLE telemetry_reports ADD COLUMN platform TEXT;
ALTER TABLE telemetry_reports ADD COLUMN device_model TEXT;
ALTER TABLE telemetry_reports ADD COLUMN device_type TEXT;   -- 'phone'|'tablet'|'desktop'|'server'
ALTER TABLE telemetry_reports ADD COLUMN os_name TEXT;
ALTER TABLE telemetry_reports ADD COLUMN os_version TEXT;
ALTER TABLE telemetry_reports ADD COLUMN app_version TEXT;

-- Backfill existing rows: every row that exists today is a self-hosted server
-- (Docker), reporting hs_version as its version and running headless.
UPDATE telemetry_reports
   SET platform = 'docker',
       device_type = 'server',
       app_version = hs_version
 WHERE platform IS NULL;

-- The dashboard filters/aggregates by platform (per-platform active counts) and
-- groups the version chart by app_version, so index both alongside reported_at.
CREATE INDEX IF NOT EXISTS idx_telemetry_platform ON telemetry_reports (platform);
CREATE INDEX IF NOT EXISTS idx_telemetry_app_version ON telemetry_reports (app_version);
