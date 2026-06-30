import { useSettingsStore } from '@/store/settingsStore'

// Best-effort detection of an in-car browser. This is an ENHANCEMENT signal,
// never a gate - UA strings drift across software updates, so the player must
// work identically when this is wrong. The manual setting ('on'/'off') always
// wins, which is the escape hatch if detection breaks. The Account > Advanced
// panel shows the live UA + this result so a mismatch can be diagnosed.
//
// Tesla browser signals across MCU generations:
//   - Older MCUs:        "QtCarBrowser"
//   - Tesla-branded UAs: "Tesla" (sometimes "Tesla/<version>")
//   - Newer (AMD/Intel): plain Chromium on "X11; Linux" - no Tesla token, so we
//     also match the in-car Chromium fingerprint (Linux + not Android, paired
//     with Tesla's typical no-touch desktop-Chrome string). We keep this last
//     clause tight to avoid matching ordinary desktop Linux Chrome: it requires
//     the Tesla-specific "Tesla" OR the legacy browser name; the Linux clause is
//     intentionally NOT included to prevent false positives. Widen here once a
//     real device UA is captured from Account > Advanced.
const CAR_UA = /Tesla|QtCarBrowser/i

export function isCarBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return CAR_UA.test(navigator.userAgent)
}

// Whether the big-touch car player should be active right now. 'auto' defers to
// UA detection; 'on'/'off' force it regardless.
export function useCarMode(): boolean {
  const mode = useSettingsStore((s) => s.carMode)
  if (mode === 'on') return true
  if (mode === 'off') return false
  return isCarBrowser()
}
