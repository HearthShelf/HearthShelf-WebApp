import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettingsStore, type CarPlayerRect } from '@/store/settingsStore'

// Size bounds for the car player card (viewport px). Min keeps the transport
// usable; max keeps it from swallowing the whole screen.
const MIN_W = 320
const MIN_H = 380
const MAX_W = 900
const MAX_H = 1100

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

// The CSS-pixel size of the viewport at the current car scale. `zoom` resizes
// the CSS pixel but leaves window.innerWidth/Height reporting UNZOOMED pixels,
// so every bound below has to be divided by the scale or the card is confined
// to a fraction of the room it actually has.
function viewport(scale: number) {
  return {
    vw: Math.round(window.innerWidth / scale),
    vh: Math.round(window.innerHeight / scale),
  }
}

// Keep a rect fully on-screen (e.g. after a viewport/orientation change).
function fitToViewport(r: CarPlayerRect, scale = 1): CarPlayerRect {
  const { vw, vh } = viewport(scale)
  const w = clamp(r.w, MIN_W, Math.min(MAX_W, vw))
  const h = clamp(r.h, MIN_H, Math.min(MAX_H, vh))
  return {
    w,
    h,
    x: clamp(r.x, 0, Math.max(0, vw - w)),
    y: clamp(r.y, 0, Math.max(0, vh - h)),
  }
}

// A sensible first-run rect: centered, comfortably large for touch.
function defaultRect(scale = 1): CarPlayerRect {
  const { vw, vh } = viewport(scale)
  const w = clamp(Math.round(vw * 0.42), MIN_W, 560)
  const h = clamp(Math.round(vh * 0.82), MIN_H, 920)
  return { w, h, x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2) }
}

interface DraggableCard {
  rect: CarPlayerRect
  /** Attach to the card's drag area (e.g. the header) to move it. */
  onDragHandlePointerDown: (e: React.PointerEvent) => void
  /** Attach to the resize grip in the corner. */
  onResizeHandlePointerDown: (e: React.PointerEvent) => void
  dragging: boolean
}

/**
 * Makes the car-mode player card draggable (by a handle) and resizable (by a
 * corner grip), clamped to the viewport and persisted to settings. `onChange`
 * fires on every move so the caller can treat dragging as a "wake" interaction.
 */
export function useDraggableCard(
  enabled: boolean,
  onInteract?: () => void,
  /** Car UI scale. Changing it resizes the CSS pixel, so the saved rect has to
   *  be re-fitted - `zoom` does not fire a window resize event. */
  scale = 1,
): DraggableCard {
  const saved = useSettingsStore((s) => s.carPlayerRect)
  const set = useSettingsStore((s) => s.set)

  const [rect, setRect] = useState<CarPlayerRect>(() =>
    saved ? fitToViewport(saved, scale) : defaultRect(scale),
  )
  // Pointer events can outpace a React render. Keep the gesture's latest rect
  // in a ref so pointer-up can persist it without causing a store update from
  // inside a React state updater (which React correctly warns about).
  const rectRef = useRef(rect)
  const [dragging, setDragging] = useState(false)

  // A live gesture: what we're doing and the pointer/rect anchors at grab time.
  const gesture = useRef<{
    mode: 'move' | 'resize'
    startX: number
    startY: number
    base: CarPlayerRect
  } | null>(null)

  // Re-fit if the viewport changes (orientation, window resize).
  useEffect(() => {
    if (!enabled) return
    const onResize = () =>
      setRect((r) => {
        const next = fitToViewport(r, scale)
        rectRef.current = next
        return next
      })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [enabled, scale])

  // Re-fit when the car scale changes: zoom changes how many CSS pixels the
  // screen holds without firing a resize, so a rect saved at one scale can hang
  // off the edge at another.
  useEffect(() => {
    if (!enabled || gesture.current) return
    setRect((r) => {
      const next = fitToViewport(r, scale)
      rectRef.current = next
      return next
    })
  }, [enabled, scale])

  // Adopt a newly-saved rect (e.g. settings reset) when not mid-gesture.
  useEffect(() => {
    if (saved && !gesture.current) {
      const next = fitToViewport(saved, scale)
      rectRef.current = next
      setRect(next)
    }
  }, [saved, scale])

  const begin = useCallback(
    (mode: 'move' | 'resize', e: React.PointerEvent) => {
      if (!enabled) return
      e.preventDefault()
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      gesture.current = { mode, startX: e.clientX, startY: e.clientY, base: rect }
      setDragging(true)
      onInteract?.()
    },
    [enabled, rect, onInteract],
  )

  const onDragHandlePointerDown = useCallback((e: React.PointerEvent) => begin('move', e), [begin])
  const onResizeHandlePointerDown = useCallback(
    (e: React.PointerEvent) => begin('resize', e),
    [begin],
  )

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => {
      const g = gesture.current
      if (!g) return
      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY
      const { vw, vh } = viewport(scale)
      if (g.mode === 'move') {
        const next = {
          ...g.base,
          x: clamp(g.base.x + dx, 0, Math.max(0, vw - g.base.w)),
          y: clamp(g.base.y + dy, 0, Math.max(0, vh - g.base.h)),
        }
        rectRef.current = next
        setRect(next)
      } else {
        const w = clamp(g.base.w + dx, MIN_W, Math.min(MAX_W, vw - g.base.x))
        const h = clamp(g.base.h + dy, MIN_H, Math.min(MAX_H, vh - g.base.y))
        const next = { ...g.base, w, h }
        rectRef.current = next
        setRect(next)
      }
      onInteract?.()
    }
    const onUp = () => {
      gesture.current = null
      setDragging(false)
      // Persist the final rect so the position/size survive reloads.
      set('carPlayerRect', rectRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragging, onInteract, set])

  return { rect, onDragHandlePointerDown, onResizeHandlePointerDown, dragging }
}
