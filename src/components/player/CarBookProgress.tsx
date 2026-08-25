import { useQuery } from '@tanstack/react-query'
import { Avatar } from '@/components/common/Avatar'
import { getMe, type AbsTarget } from '@/api/absLibrary'
import { formatTimestamp } from '@hearthshelf/core'
import type { HSClubMember } from '@hearthshelf/core'

export function CarBookProgress({
  position,
  duration,
  chapterIndex,
  chapterCount,
  members = [],
  target,
}: {
  position: number
  duration: number
  chapterIndex: number
  chapterCount: number
  members?: HSClubMember[]
  target?: AbsTarget
}) {
  const ratio = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0
  const { data: me } = useQuery({
    queryKey: ['abs-me', target?.serverId ?? ''],
    queryFn: () => getMe(target as AbsTarget),
    enabled: Boolean(target),
    staleTime: 10 * 60 * 1000,
  })

  return (
    <div className="car-book-progress" aria-label={`Book progress ${Math.round(ratio * 100)}%`}>
      <div className="car-book-progress-head">
        <strong>{Math.round(ratio * 100)}%</strong>
        <span>
          Ch {chapterIndex + 1} / {chapterCount || 1}
        </span>
      </div>
      <div className="car-book-progress-track">
        <i style={{ transform: `scaleX(${ratio})` }} />
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
    </div>
  )
}
