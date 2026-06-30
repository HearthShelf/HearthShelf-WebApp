import { useRef, useState } from 'react'

/**
 * A draggable progress bar, used everywhere a player shows a seekable
 * position (chapter or whole-book). Previously every call site only handled
 * onClick (tap-to-jump worked, but you couldn't grab the knob and drag).
 *
 * While dragging, the displayed ratio tracks the pointer locally - onSeek is
 * only called once, on release, so a drag that crosses a chapter/track
 * boundary doesn't reload audio on every pointermove. A plain tap (no
 * movement) still seeks immediately on pointer-up, same as the old onClick.
 */
export function Scrubber({
  ratio,
  onSeek,
  onDrag,
  className = '',
  knob = true,
}: {
  /** Current position, 0-1. Ignored while actively dragging. */
  ratio: number
  /** Called once, with the new 0-1 ratio, when a tap or drag ends. */
  onSeek: (ratio: number) => void
  /** Fires continuously while dragging with the live 0-1 ratio, and once with
   * null when the drag/tap ends - so the caller can preview the target time
   * in its own time labels without committing a seek. */
  onDrag?: (ratio: number | null) => void
  className?: string
  /** Some scrub bars (the compact mini-player one) hide the knob via CSS at
   * small sizes anyway; default on. */
  knob?: boolean
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragRatio, setDragRatio] = useState<number | null>(null)
  // Refs (not state) gate the move/up handlers so a pointermove that fires in
  // the same tick as pointerdown - before React commits the state update -
  // still counts as an active drag. The state copy only drives the re-render.
  const activeRef = useRef(false)
  const movedRef = useRef(false)
  const lastRatioRef = useRef(0)

  const ratioFromEvent = (clientX: number) => {
    const track = trackRef.current
    if (!track) return 0
    const r = track.getBoundingClientRect()
    if (r.width <= 0) return 0
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    activeRef.current = true
    movedRef.current = false
    const r = ratioFromEvent(e.clientX)
    lastRatioRef.current = r
    setDragRatio(r)
    onDrag?.(r)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeRef.current) return
    movedRef.current = true
    const r = ratioFromEvent(e.clientX)
    lastRatioRef.current = r
    setDragRatio(r)
    onDrag?.(r)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeRef.current) return
    activeRef.current = false
    const final = movedRef.current ? lastRatioRef.current : ratioFromEvent(e.clientX)
    setDragRatio(null)
    onDrag?.(null)
    onSeek(final)
  }

  const onPointerCancel = () => {
    if (!activeRef.current) return
    activeRef.current = false
    setDragRatio(null)
    onDrag?.(null)
  }

  const shown = dragRatio ?? ratio
  const pct = Math.max(0, Math.min(1, shown)) * 100

  return (
    <div
      ref={trackRef}
      className={'seekable' + (className ? ' ' + className : '') + (dragRatio !== null ? ' dragging' : '')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <i style={{ width: pct + '%' }} />
      {knob && <b style={{ left: pct + '%' }} />}
    </div>
  )
}
