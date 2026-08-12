-- Mark simulator/emulator reports so the public rollup can exclude them.
--
-- The mobile telemetry_id is the app's deviceId, which lives in AsyncStorage. A
-- sideload or a rebuilt simulator wipes that storage, so every dev install
-- minted a NEW id and inserted a NEW row instead of updating one. The result on
-- hearthshelf.com/stats was a fleet of phantom installs ("Simulator iOS - 28
-- phones") and a long tail of stale versions that never aged out, because those
-- rows are never touched again.
--
-- Ingest now flags these rows and the rollup filters them out. Flagging beats
-- dropping at ingest: the raw rows stay available for debugging, and the filter
-- applies retroactively to rows already stored.

ALTER TABLE telemetry_reports ADD COLUMN is_dev INTEGER NOT NULL DEFAULT 0;

-- Backfill the rows already collected. Mirrors DEV_MODEL_RE in
-- control-plane/src/lib/telemetry.ts - keep the two in sync.
UPDATE telemetry_reports
   SET is_dev = 1
 WHERE device_model IS NOT NULL
   AND (
     LOWER(device_model) LIKE '%simulator%'
     OR LOWER(device_model) LIKE '%emulator%'
     OR LOWER(device_model) LIKE '%sdk built%'
     OR LOWER(device_model) LIKE '%sdk_built%'
     OR LOWER(device_model) LIKE '%generic%'
     OR LOWER(device_model) LIKE '%virtual%'
     OR LOWER(device_model) LIKE '%google_sdk%'
     OR LOWER(device_model) LIKE '%android sdk%'
   );

-- The rollup filters on this in every query, alongside reported_at.
CREATE INDEX IF NOT EXISTS idx_telemetry_dev ON telemetry_reports (is_dev, reported_at);
