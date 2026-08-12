-- Second pass at the telemetry cleanup, from what the live data showed.
--
-- 1. sdk_gphone* emulators were never flagged. The 0015 pattern matched
--    "sdk built" and "google_sdk" but not the name a modern Android Studio
--    emulator actually reports, so it counted as a real phone. Matching any
--    model containing "sdk" is safe: no shipping handset reports one.
--
-- 2. The 0016 purge required rows to be older than 14 days, and every phantom
--    OnePlus8Pro row was NEWER than that - 26 sideloads inside two weeks - so it
--    deleted none of them. The age test was the wrong instrument.
--
--    The right one is the id shape. Mobile telemetry ids are now
--    "ios-<vendor>" / "and-<ssaid>" and survive a reinstall; the old ones were
--    bare AsyncStorage UUIDs that a reinstall replaced, which is exactly what
--    created the duplicates. So: for any device model that ALREADY reports under
--    a stable id, drop the legacy UUID rows for that same model. They are dead
--    by construction - the device now reports under its stable id instead.
--
--    Scoped deliberately: a device that has not yet upgraded keeps all its rows
--    (no stable id present, nothing deleted), and server rows have no
--    device_model so they can never be touched.

-- 1. Flag emulator images missed by 0015.
UPDATE telemetry_reports
   SET is_dev = 1
 WHERE is_dev = 0
   AND device_model IS NOT NULL
   AND LOWER(device_model) LIKE '%sdk%';

-- 2. Drop legacy-id rows for devices that now report under a stable id.
DELETE FROM telemetry_reports
 WHERE device_model IS NOT NULL
   AND telemetry_id NOT LIKE 'ios-%'
   AND telemetry_id NOT LIKE 'and-%'
   AND device_model IN (
     SELECT device_model FROM telemetry_reports
      WHERE device_model IS NOT NULL
        AND (telemetry_id LIKE 'ios-%' OR telemetry_id LIKE 'and-%')
   );
