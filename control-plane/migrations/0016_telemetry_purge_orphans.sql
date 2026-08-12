-- One-off cleanup of phantom installs created before the telemetry id was stable.
--
-- The mobile telemetry_id used to be the app's AsyncStorage deviceId, so every
-- sideload minted a new id and inserted a NEW row rather than updating one. Those
-- rows are orphans: nothing will ever report against them again, so they sit at
-- whatever version they last saw until the 60-day active window finally drops
-- them. On a project this young they dominated the public stats - a long tail of
-- old versions that looked like real installs stuck on old builds.
--
-- The simulator/emulator rows are handled by is_dev in 0015. This handles the
-- rest: rows on a REAL device model that have not been heard from in over two
-- weeks AND are not the newest row for that device model. Keeping the newest per
-- model means a genuine install is never deleted - at worst it re-reports on its
-- next launch anyway, since the id is now stable across reinstalls.
--
-- Deliberately narrow. It cannot touch server rows (no device_model) and cannot
-- remove the only row for any device.

DELETE FROM telemetry_reports
 WHERE device_model IS NOT NULL
   AND is_dev = 0
   AND reported_at < (strftime('%s','now') * 1000 - 14 * 24 * 60 * 60 * 1000)
   AND telemetry_id NOT IN (
     SELECT telemetry_id FROM (
       SELECT telemetry_id,
              ROW_NUMBER() OVER (PARTITION BY device_model ORDER BY reported_at DESC) AS rn
         FROM telemetry_reports
        WHERE device_model IS NOT NULL AND is_dev = 0
     ) ranked
      WHERE rn = 1
   );
