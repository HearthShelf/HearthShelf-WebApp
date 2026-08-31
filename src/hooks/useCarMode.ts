import { useSettingsStore, type CarMode } from '@/store/settingsStore'

// Best-effort detection of an in-car browser. This is an ENHANCEMENT signal,
// never a gate - UA strings drift across software updates, so the player must
// work identically when this is wrong. The manual setting ('on'/'off') always
// wins, which is the escape hatch if detection breaks. The Account > Advanced
// panel shows the live UA + this result so a mismatch can be diagnosed.
//
// Tesla browser signals across MCU generations:
//   - Older MCUs:        "QtCarBrowser"
//   - Tesla-branded UAs: "Tesla" (sometimes "Tesla/<version>")
//   - Newer (AMD/Intel, MCU2/MCU-Z): plain Chromium on "X11; Linux x86_64" with
//     NO Tesla token at all - confirmed via a real captured UA from Account >
//     Advanced: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML,
//     like Gecko) Chrome/140.0.7339.207 Safari/537.36". This is byte-for-byte
//     identical to a real desktop Linux Chrome UA, so it cannot be told apart
//     from the UA string alone - the regex below intentionally does NOT widen
//     to match it (would misdetect every Linux desktop Chrome user).
//
// Instead, the newer-MCU case is caught with a UA-independent signal: Tesla's
// center touchscreen is touch-only with no mouse/trackpad, which a desktop
// Linux user (even on a touch monitor) essentially never matches at the same
// time as having no fine pointer at all. `any-pointer: fine` is present
// whenever ANY attached pointer (mouse, trackpad, stylus) supports precise
// input, even on a touch laptop - so "coarse-only, no fine pointer at all" is
// a meaningfully tighter signal than `(pointer: coarse)` alone. Paired with
// Tesla's known panel resolutions (Model 3/Y: 1920x1200, Model S/X refresh:
// 2200x1300) this stays narrow. Still best-effort: a kiosk touch monitor with
// no mouse at one of these exact resolutions would also match.
const CAR_UA = /Tesla|QtCarBrowser/i

const TESLA_SCREEN_SIZES: [number, number][] = [
  [1920, 1200], // Model 3 / Model Y
  [2200, 1300], // Model S / Model X (2021+ refresh)
]
/** Panel sizes are matched within this many px per axis. */
const SIZE_TOLERANCE = 24

function isTouchOnlyTeslaSizedScreen(): boolean {
  if (typeof window === 'undefined' || typeof screen === 'undefined') return false
  const touchOnly =
    window.matchMedia?.('(any-pointer: coarse)').matches &&
    !window.matchMedia?.('(any-pointer: fine)').matches
  if (!touchOnly) return false
  // screen.width/height are CSS px, so they shrink when the device pixel ratio
  // changes. A 2026 Tesla software update moved the ratio to ~1.53, turning a
  // reported 1920x1200 into 1254x784 with no hardware change - so the panel
  // sizes have to be compared in PHYSICAL px (CSS px x DPR), which stays put.
  const dpr = window.devicePixelRatio || 1
  const w = screen.width * dpr
  const h = screen.height * dpr
  const near = (a: number, b: number) => Math.abs(a - b) <= SIZE_TOLERANCE
  return TESLA_SCREEN_SIZES.some(
    ([sw, sh]) => (near(w, sw) && near(h, sh)) || (near(w, sh) && near(h, sw)),
  )
}

export function isCarBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  if (CAR_UA.test(navigator.userAgent)) return true
  return isTouchOnlyTeslaSizedScreen()
}

// Resolve the effective car-mode state from a carMode setting. 'auto' defers to
// UA detection; 'on'/'off' force it regardless. Non-reactive, so it can be
// called outside React (e.g. when opening a play session).
export function resolveCarMode(mode: CarMode): boolean {
  if (mode === 'on') return true
  if (mode === 'off') return false
  return isCarBrowser()
}

// Read the effective car-mode state once, without subscribing. For play-session
// tagging where we just need the current value at call time.
export function isCarModeActive(): boolean {
  return resolveCarMode(useSettingsStore.getState().carMode)
}

// Whether car mode should be active right now. 'auto' defers to UA detection;
// 'on'/'off' force it regardless.
export function useCarMode(): boolean {
  const mode = useSettingsStore((s) => s.carMode)
  return resolveCarMode(mode)
}
