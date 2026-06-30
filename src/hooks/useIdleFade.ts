import { useCallback, useEffect, useRef, useState } from 'react'

interface IdleFade {
  /** True once the idle timeout has elapsed: hide non-essential chrome. */
  faded: boolean
  /**
   * A "full" interaction: un-fade (if faded) and restart the idle timer.
   * Use for taps on the card, play/pause, panels - anything that means the
   * driver wants the controls back.
   */
  wake: () => void
  /**
   * A "transport" interaction: restart the idle timer but DO NOT un-fade.
   * Use for skip-seconds / skip-chapter so the driver can nudge playback
   * without the full chrome flashing back in.
   */
  tick: () => void
}

/**
 * Drives the car-mode auto-fade. After `ms` with no `wake()`, `faded` flips
 * true and the UI sheds everything but the core transport. `tick()` keeps the
 * timer alive without revealing chrome; `wake()` reveals it and resets.
 *
 * When `enabled` is false the hook is inert (always revealed) - so leaving car
 * mode immediately restores the full UI.
 */
export function useIdleFade(enabled: boolean, ms = 60_000): IdleFade {
  const [faded, setFaded] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const arm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setFaded(true), ms)
  }, [ms])

  const wake = useCallback(() => {
    if (!enabled) return
    setFaded(false)
    arm()
  }, [enabled, arm])

  const tick = useCallback(() => {
    if (!enabled) return
    arm()
  }, [enabled, arm])

  // Arm on enable; fully reset (revealed, no timer) on disable.
  useEffect(() => {
    if (!enabled) {
      if (timer.current) clearTimeout(timer.current)
      setFaded(false)
      return
    }
    arm()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [enabled, arm])

  return { faded, wake, tick }
}
