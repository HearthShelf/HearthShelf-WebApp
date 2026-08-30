import { useRef, useState } from 'react'
import { formatTimestamp } from '@hearthshelf/core'
import { Icon } from '@/components/common/Icon'

/** How far the pill must travel before a release throws it away. */
const DISMISS_PX = 72

/**
 * "Jump to furthest": offered after a large backwards seek. Tapping returns to
 * the spot playback had reached; dragging the pill sideways throws that spot
 * away instead.
 *
 * The web counterpart of the mobile pill, same gesture and same reasoning:
 * dismissal exists because the furthest point isn't always worth going back to
 * (asleep with no sleep timer leaves it hours ahead of anything heard).
 */
export function ReturnPositionPill({
  position,
  onJump,
  onDismiss,
}: {
  position: number
  onJump: () => void
  onDismiss: () => void
}) {
  const [dx, setDx] = useState(0)
  const start = useRef<number | null>(null)

  const end = () => {
    if (start.current === null) return
    start.current = null
    if (Math.abs(dx) > DISMISS_PX) onDismiss()
    else setDx(0)
  }

  return (
    <div
      className="return-pill-wrap"
      style={{
        transform: `translateX(${dx}px)`,
        // Weaken with the drag so it visibly approaches release.
        opacity: Math.max(0, 1 - Math.abs(dx) / (DISMISS_PX * 2)),
      }}
      onPointerDown={(e) => {
        start.current = e.clientX
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (start.current !== null) setDx(e.clientX - start.current)
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <button
        type="button"
        className="return-pill"
        onClick={() => {
          // A drag that moved is a dismissal gesture, not a tap.
          if (Math.abs(dx) < 4) onJump()
        }}
        aria-label={`Jump to furthest position, ${formatTimestamp(position)}`}
        title="Drag sideways to forget this spot"
      >
        <Icon name="history" />
        <span>Jump to furthest</span>
        <b>{formatTimestamp(position)}</b>
      </button>
    </div>
  )
}
