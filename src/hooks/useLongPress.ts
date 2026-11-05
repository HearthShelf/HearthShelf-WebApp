import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

const HOLD_MS = 500
// A finger always drifts a little; more than this is a scroll or a drag.
const MOVE_TOLERANCE = 10

/**
 * Press-and-hold on any pointer. Spread `handlers` onto the element. The click
 * that ends a hold is swallowed, so holding a link never also follows it.
 */
export function useLongPress(onHold: (x: number, y: number) => void) {
  const timer = useRef<number | null>(null)
  const start = useRef({ x: 0, y: 0 })
  const held = useRef(false)
  const latest = useRef(onHold)

  useEffect(() => {
    latest.current = onHold
  })

  const cancel = () => {
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = null
  }

  useEffect(() => cancel, [])

  return {
    cancel,
    handlers: {
      onPointerDown(e: PointerEvent) {
        held.current = false
        if (e.button !== 0) return
        const { clientX: x, clientY: y } = e
        start.current = { x, y }
        cancel()
        timer.current = window.setTimeout(() => {
          timer.current = null
          held.current = true
          latest.current(x, y)
        }, HOLD_MS)
      },
      onPointerMove(e: PointerEvent) {
        if (timer.current == null) return
        const dx = e.clientX - start.current.x
        const dy = e.clientY - start.current.y
        if (Math.hypot(dx, dy) > MOVE_TOLERANCE) cancel()
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onDragStart: cancel,
      onClickCapture(e: MouseEvent) {
        if (!held.current) return
        held.current = false
        e.preventDefault()
        e.stopPropagation()
      },
    },
  }
}
