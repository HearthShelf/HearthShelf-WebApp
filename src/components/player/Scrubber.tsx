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
  className = '',
  knob = true,
}: {
  /** Current position, 0-1. Ignored while actively dragging. */
  ratio: number
  /** Called once, with the new 0-1 ratio, when a tap or drag ends. */
  onSeek: (ratio: number) => void
  className?: string
  /** Some scrub bars (the compact mini-player one) hide the knob via CSS at
   * small sizes anyway; default on. */
  knob?: boolean
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragRatio, setDragRatio] = useState<number | null>(null)
  const movedRef = useRef(false)

  const ratioFromEvent = (clientX: number) => {
    const track = trackRef.current
    if (!track) return 0
    const r = track.getBoundingClientRect()
    if (r.width <= 0) return 0
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    movedRef.current = false
    setDragRatio(ratioFromEvent(e.clientX))
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRatio === null) return
    movedRef.current = true
    setDragRatio(ratioFromEvent(e.clientX))
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRatio === null) return
    const final = movedRef.current ? dragRatio : ratioFromEvent(e.clientX)
    setDragRatio(null)
    onSeek(final)
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
      onPointerCancel={() => setDragRatio(null)}
    >
      <i style={{ width: pct + '%' }} />
      {knob && <b style={{ left: pct + '%' }} />}
    </div>
  )
}
