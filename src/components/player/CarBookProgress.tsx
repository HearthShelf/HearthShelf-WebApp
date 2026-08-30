import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Avatar } from '@/components/common/Avatar'
import { getMe, type AbsTarget } from '@/api/absLibrary'
import { formatTimestamp } from '@hearthshelf/core'
import type { HSClubMember, TimelineMarker } from '@hearthshelf/core'
import { Icon } from '@/components/common/Icon'

export function CarBookProgress({
  position,
  duration,
  chapterIndex,
  chapterCount,
  members = [],
  markers = [],
  target,
  onOpenClub,
}: {
  position: number
  duration: number
  chapterIndex: number
  chapterCount: number
  members?: HSClubMember[]
  /** Clustered comment positions, same data the touch scrubber marks. Shown so
   *  the car track answers "is there anything at this point in the book" at a
   *  glance. Display only - a driver never taps these to open a note. */
  markers?: TimelineMarker[]
  target?: AbsTarget
  /** Opens the club chat. The bar is the one thing on screen already showing
   *  who else is reading and where the comments are, so it's the natural place
   *  to reach for the conversation. Omitted when there's no club to open. */
  onOpenClub?: () => void
}) {
  const ratio = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0
  const { data: me } = useQuery({
    queryKey: ['abs-me', target?.serverId ?? ''],
    queryFn: () => getMe(target as AbsTarget),
    enabled: Boolean(target),
    staleTime: 10 * 60 * 1000,
  })

  // The bar's height varies with its content (avatars, marker glyphs, safe-area
  // inset), and the club chat layer has to start below it. Publish the measured
  // height so CSS can lay out against the real number instead of a guess that
  // drifts.
  const barRef = useRef<HTMLDivElement | HTMLButtonElement | null>(null)
  useEffect(() => {
    const el = barRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const publish = () =>
      document.documentElement.style.setProperty(
        '--car-progress-h',
        `${Math.round(el.getBoundingClientRect().height)}px`,
      )
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const Root = onOpenClub ? 'button' : 'div'
  return (
    <Root
      ref={barRef as never}
      className={'car-book-progress' + (onOpenClub ? ' tappable' : '')}
      {...(onOpenClub
        ? { type: 'button' as const, onClick: onOpenClub, title: 'Open the book club' }
        : {})}
      aria-label={
        onOpenClub
          ? `Book progress ${Math.round(ratio * 100)}% - open the book club`
          : `Book progress ${Math.round(ratio * 100)}%`
      }
    >
      <div className="car-book-progress-head">
        <strong>{Math.round(ratio * 100)}%</strong>
        <span>
          Ch {chapterIndex + 1} / {chapterCount || 1}
        </span>
      </div>
      <div className="car-book-progress-track">
        <i style={{ transform: `scaleX(${ratio})` }} />
        {markers.length > 0 && (
          <div className="car-progress-markers" aria-label="Comment positions">
            {markers.map((m, i) => (
              <span
                key={i}
                className={m.kind === 'stub' ? 'locked' : m.kind === 'mixed' ? 'mixed' : ''}
                style={{ left: `${m.fraction * 100}%` }}
              >
                <Icon name="chat_bubble" fill />
                {m.count > 1 && <b>{m.count}</b>}
              </span>
            ))}
          </div>
        )}
        {members.length > 0 && (
          <div className="club-progress-markers" aria-label="Book Club reader progress">
            {members.map((member) => {
              // The connected reader follows the local player every tick. The
              // server member snapshot only refreshes periodically, which made
              // their avatar drift away from the live fill while listening.
              const memberRatio =
                member.userId === me?.id
                  ? ratio
                  : member.isFinished
                    ? 1
                    : member.currentTime != null &&
                        member.duration != null &&
                        member.duration > 0
                      ? Math.max(0, Math.min(1, member.currentTime / member.duration))
                      : 0
              return (
                <span
                  key={member.userId}
                  className={member.listeningNow ? 'listening' : ''}
                  style={{ left: `${memberRatio * 100}%` }}
                  title={`${member.username} · ${Math.round(memberRatio * 100)}%`}
                >
                  <Avatar
                    name={member.username || 'Reader'}
                    target={target}
                    userId={member.userId}
                    size={24}
                  />
                </span>
              )
            })}
          </div>
        )}
      </div>
      <div className="car-book-progress-times">
        <span>{formatTimestamp(position)} elapsed</span>
        <span>{formatTimestamp(Math.max(0, duration - position))} left</span>
      </div>
    </Root>
  )
}
