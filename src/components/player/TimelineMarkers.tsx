import type { TimelineMarker } from '@hearthshelf/core'
import { formatTimestamp } from '@hearthshelf/core'

/**
 * Note markers overlaid on the full-book scrubber: small avatar-less dots for
 * unlocked notes you've passed, thin anonymous ticks for locked ahead-notes.
 * Purely visual + click-to-open; the scrubber underneath still handles drag/
 * seek since this sits in a non-interactive absolutely positioned layer,
 * except the marker dots themselves which stop propagation to seek instead.
 */
export function TimelineMarkers({
  markers,
  onOpenNote,
  onOpenTeaser,
}: {
  markers: TimelineMarker[]
  onOpenNote?: (id: string) => void
  onOpenTeaser?: (timeSec: number) => void
}) {
  if (markers.length === 0) return null
  return (
    <div className="timeline-markers" aria-hidden={false}>
      {markers.map((m, i) => {
        const isStub = m.kind === 'stub'
        const label = isStub
          ? m.count > 1
            ? `${m.count} notes ahead`
            : `A note awaits at ${formatTimestamp(m.items[0]?.timeSec ?? 0)}`
          : m.count > 1
            ? `${m.count} notes here`
            : `Note by ${m.items[0]?.username ?? 'someone'}`
        return (
          <button
            key={i}
            type="button"
            className={'timeline-marker' + (isStub ? ' locked' : '') + (m.kind === 'mixed' ? ' mixed' : '')}
            style={{ left: `${m.fraction * 100}%` }}
            title={label}
            onClick={(e) => {
              e.stopPropagation()
              if (isStub) onOpenTeaser?.(m.items[0]?.timeSec ?? 0)
              else onOpenNote?.(m.items[0]?.id ?? '')
            }}
          >
            {m.count > 1 && <span className="timeline-marker-count">{m.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
