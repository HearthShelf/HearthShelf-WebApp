import { useQuery } from '@tanstack/react-query'
import { getRecentSessions, type RecentSession } from '@/api/absPlayback'
import { useActiveServer } from '@/hooks/useActiveServer'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { formatTimestamp, fmtSessDate } from '@hearthshelf/core'
import type { AbsTarget } from '@/api/absLibrary'

/** Minimal chapter shape needed to label a session's position range. All player
 *  call sites already normalize chapters to { title, start, end } in seconds. */
interface ChapterSpan {
  title: string
  start: number
  end: number
}

function deviceIcon(s: RecentSession): string {
  const os = (s.deviceInfo?.osName ?? '').toLowerCase()
  if (os.includes('android') || os.includes('ios')) return 'smartphone'
  if (s.deviceInfo?.browserName) return 'language'
  return 'computer'
}

// Recent listening sessions for the book that is playing now. Tapping a row
// jumps the player back to where that session started. Shared by the mobile
// player sheet and the desktop player popover.
export function RecentListens({
  libraryItemId,
  chapters,
  onSeek,
}: {
  libraryItemId: string
  /** Book chapters, so each session row can show the chapter(s) it spanned. When
   *  omitted the chapter line is simply hidden. */
  chapters?: ChapterSpan[]
  onSeek: (seconds: number) => void
}) {
  const { target } = useActiveServer()
  const { data, isLoading } = useQuery({
    queryKey: ['abs-recent-sessions', target?.serverId],
    queryFn: () => getRecentSessions(target as AbsTarget),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  const sessions = (data ?? []).filter((s) => s.libraryItemId === libraryItemId)

  const chapterAt = (sec: number): string | null => {
    const c = chapters?.find((ch) => sec >= ch.start && sec < ch.end)
    return c?.title ?? null
  }

  if (isLoading) {
    return <LoadingSpinner className="py-8" label="Loading..." />
  }

  if (sessions.length === 0) {
    return (
      <div
        style={{
          padding: '30px 20px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 13,
        }}
      >
        You haven't listened to this book yet.
      </div>
    )
  }

  return (
    <div className="recent-listens">
      {sessions.map((s) => {
        const dt = fmtSessDate(s.startedAt)
        const startCh = chapterAt(s.startTime)
        const endCh = chapterAt(s.currentTime)
        const chapterLabel =
          startCh && endCh && startCh !== endCh ? `${startCh} → ${endCh}` : (endCh ?? startCh)
        return (
          <button
            key={s.id}
            className="recent-row"
            onClick={() => onSeek(s.startTime)}
            title="Play from where this session started"
          >
            <Icon name={deviceIcon(s)} style={{ color: 'var(--text-muted)', fontSize: 19 }} />
            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="schedule" style={{ color: 'var(--primary)', fontSize: 15 }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--primary)' }}>
                  {formatTimestamp(s.timeListening)} listened
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {dt.day} · {dt.time}
                </span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, marginTop: 2 }}>
                {formatTimestamp(s.startTime)} {'→'} {formatTimestamp(s.currentTime)}
              </div>
              {chapterLabel && (
                <div
                  style={{
                    fontSize: 11.5,
                    color: 'var(--text-muted)',
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {chapterLabel}
                </div>
              )}
            </div>
            <Icon name="replay" style={{ color: 'var(--text-muted)', fontSize: 20 }} />
          </button>
        )
      })}
    </div>
  )
}
