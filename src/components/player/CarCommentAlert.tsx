import { useMemo } from 'react'
import { formatTimestamp } from '@hearthshelf/core'
import type { TimelineMarker } from '@hearthshelf/core'
import { Icon } from '@/components/common/Icon'

/** How far ahead of a comment the countdown appears, in seconds of book time. */
const LEAD_SECONDS = 300

/**
 * Car mode's heads-up for a comment you're about to reach: a small corner card
 * that appears about five minutes before it and counts down.
 *
 * The car progress bar already shows WHERE comments sit in the book, but a
 * driver isn't studying the bar - this is the part that says "something is
 * coming up" without asking for a glance. Purely informational: it never steals
 * focus and there is nothing to tap, since reading the comment itself has to
 * wait until you reach it anyway.
 */
export function CarCommentAlert({
  markers,
  position,
  rate,
  suppressed = false,
}: {
  markers: TimelineMarker[]
  position: number
  /** Playback speed, so the countdown reads in real seconds rather than book
   *  seconds - at 1.5x a "5 minutes away" comment is 3.3 minutes away. */
  rate: number
  /** Hidden while the club chat is open: the countdown is a nudge toward the
   *  conversation, and the conversation is already on screen. */
  suppressed?: boolean
}) {
  const next = useMemo(() => {
    let soonest: { timeSec: number; count: number; locked: boolean } | null = null
    for (const marker of markers) {
      for (const item of marker.items) {
        if (item.timeSec <= position) continue
        if (soonest && item.timeSec >= soonest.timeSec) continue
        soonest = {
          timeSec: item.timeSec,
          count: marker.count,
          locked: marker.kind === 'stub',
        }
      }
    }
    return soonest
  }, [markers, position])

  if (suppressed || !next) return null
  const bookSecondsAway = next.timeSec - position
  if (bookSecondsAway > LEAD_SECONDS) return null
  const secondsAway = rate > 0 ? bookSecondsAway / rate : bookSecondsAway

  return (
    <div className="car-comment-alert" role="status" aria-live="polite">
      <Icon name={next.locked ? 'lock' : 'chat_bubble'} fill />
      <div className="cca-copy">
        <strong>
          {next.count > 1
            ? `${next.count} comments coming up`
            : next.locked
              ? 'A comment unlocks soon'
              : 'Comment coming up'}
        </strong>
        <small>{formatTimestamp(Math.max(0, secondsAway))} away</small>
      </div>
    </div>
  )
}
