import { useSettingsStore } from '@/store/settingsStore'
import { useVisualViewportSize } from '@/hooks/useVisualViewportSize'

/** Never shrink past this - below it the transport stops being a safe car target. */
const MIN_SCALE = 0.5
/** Auto never enlarges; a normal screen stays exactly as authored. */
const MAX_SCALE = 1

/**
 * How much to shrink the car UI, as a CSS zoom factor (1 = as authored).
 *
 * A 2026 Tesla software update raised the browser's device pixel ratio to
 * ~1.53 without changing the panel. The physical screen is the same size, but
 * the CSS viewport collapsed from 1180x919 to 773x601, so everything authored
 * in CSS px renders about 1.5x larger and the layout no longer fits.
 *
 * 'auto' divides that ratio back out, which self-corrects: if Tesla reverses
 * the change, dpr returns to 1, this returns 1, and nothing is scaled. The
 * fixed percentages are the escape hatch for when the computed value doesn't
 * suit the car.
 */
export function useCarScale(): number {
  const setting = useSettingsStore((s) => s.carScale)
  // Re-read on viewport changes so a dpr change mid-session is picked up.
  useVisualViewportSize()

  if (setting !== 'auto') return setting / 100
  if (typeof window === 'undefined') return 1
  const dpr = window.devicePixelRatio || 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, 1 / dpr))
}
