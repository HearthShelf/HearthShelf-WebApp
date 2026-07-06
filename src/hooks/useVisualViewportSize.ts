import { useSyncExternalStore } from 'react'

// The visual viewport's current pixel size, tracked live.
//
// Car mode pins the hearth background to these pixels instead of the layout
// viewport (`100vw/100vh` / `inset: 0`). Tesla's browser drops a "video not
// available" banner in and out on play/pause, which nudges the LAYOUT viewport
// height by a few pixels and makes an `inset: 0` background reflow - a jarring
// shift every time you tap play. The VISUAL viewport (window.visualViewport)
// reports the actually-painted area and is what we lock to so that jitter
// stops moving the image.
//
// Same external-store shape as useMediaQuery so every caller shares one
// subscription and useSyncExternalStore stays referentially stable. The
// snapshot is a "WxH" string (not an object) so getSnapshot returns a stable
// primitive - returning a fresh object each call would loop React forever.

interface ViewportSize {
  width: number
  height: number
}

function measure(): string {
  if (typeof window === 'undefined') return '0x0'
  const vv = window.visualViewport
  const w = Math.round(vv?.width ?? window.innerWidth)
  const h = Math.round(vv?.height ?? window.innerHeight)
  return `${w}x${h}`
}

function subscribe(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const vv = window.visualViewport
  // visualViewport fires resize/scroll on banner show/hide and zoom; window
  // resize covers browsers without visualViewport (fallback path in measure()).
  vv?.addEventListener('resize', cb)
  vv?.addEventListener('scroll', cb)
  window.addEventListener('resize', cb)
  return () => {
    vv?.removeEventListener('resize', cb)
    vv?.removeEventListener('scroll', cb)
    window.removeEventListener('resize', cb)
  }
}

export function useVisualViewportSize(): ViewportSize {
  const snapshot = useSyncExternalStore(subscribe, measure, () => '0x0')
  const [w, h] = snapshot.split('x')
  return { width: Number(w), height: Number(h) }
}
