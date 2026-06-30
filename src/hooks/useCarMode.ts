import { useSettingsStore } from '@/store/settingsStore'

// Best-effort detection of an in-car browser. Tesla's browser is Chromium and
// puts "Tesla" (older MCUs: "QtCarBrowser") in the user-agent. This is an
// ENHANCEMENT signal, never a gate - UA strings drift across software updates,
// so the player must work identically when this is wrong. The manual setting
// ('on'/'off') always wins, which is the escape hatch if detection breaks.
const CAR_UA = /\bTesla\b|QtCarBrowser/i

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
