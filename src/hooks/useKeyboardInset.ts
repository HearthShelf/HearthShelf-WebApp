import { useEffect, useRef, useState } from 'react'

/** Below this, a viewport change is browser-chrome jitter, not a keyboard. */
const MIN_KEYBOARD_PX = 120

/**
 * How many pixels at the bottom of the screen an on-screen keyboard is
 * covering, or 0 when none is up.
 *
 * Two signals, because browsers disagree. Where the visual viewport shrinks for
 * the keyboard (iOS, Android Chrome) that difference IS the inset. Some
 * desktop-class Chromium builds - which is what car dashboards run - leave the
 * visual viewport alone and the keyboard simply paints over the page; there the
 * only hint is that a text field has focus, so a caller-supplied estimate is
 * used instead.
 *
 * The baseline is the tallest visual viewport seen this session rather than
 * window.innerHeight: the Tesla browser's transient "video not available"
 * banner nudges the layout viewport, which would read as a small phantom
 * keyboard.
 */
export function useKeyboardInset(fallbackPx = 320): number {
  const [inset, setInset] = useState(0)
  const tallest = useRef(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const vv = window.visualViewport

    const measure = () => {
      const height = vv?.height ?? window.innerHeight
      if (height > tallest.current) tallest.current = height

      const shrink = tallest.current - height
      if (shrink > MIN_KEYBOARD_PX) {
        // The viewport told us directly. offsetTop covers browsers that scroll
        // the visual viewport up rather than shortening it.
        setInset(shrink + (vv?.offsetTop ?? 0))
        return
      }

      // No viewport change: fall back to "is a text field focused". Only
      // editable elements count - a focused button is not a keyboard.
      const el = document.activeElement as HTMLElement | null
      const editable =
        el != null &&
        (el.tagName === 'TEXTAREA' ||
          (el.tagName === 'INPUT' &&
            !['button', 'submit', 'checkbox', 'radio', 'range', 'file'].includes(
              (el as HTMLInputElement).type,
            )) ||
          el.isContentEditable)
      setInset(editable ? fallbackPx : 0)
    }

    measure()
    vv?.addEventListener('resize', measure)
    vv?.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    // focusin/focusout are the only signal on browsers whose viewport never moves.
    document.addEventListener('focusin', measure)
    document.addEventListener('focusout', measure)
    return () => {
      vv?.removeEventListener('resize', measure)
      vv?.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      document.removeEventListener('focusin', measure)
      document.removeEventListener('focusout', measure)
    }
  }, [fallbackPx])

  return inset
}
