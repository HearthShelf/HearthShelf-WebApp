-- Flag the CI emulator profile that reports a real device name.
--
-- GitHub Actions' Android runner boots as a "OnePlus8Pro" on Android 11, so
-- nothing in the model string marks it as an emulator - it read as the single
-- most popular phone in the community. Earlier passes only removed the DUPLICATE
-- rows it produced; the remaining one is still a build machine, and now that
-- mobile ids are stable it would report on every CI run forever instead of
-- ageing out.
--
-- Matched on model AND OS version together, so someone genuinely using that
-- handset on a later Android is still counted. Mirrors CI_PROFILES in
-- control-plane/src/lib/telemetry.ts - keep the two in sync.

UPDATE telemetry_reports
   SET is_dev = 1
 WHERE is_dev = 0
   AND device_model = 'OnePlus8Pro'
   AND os_version = '11';
