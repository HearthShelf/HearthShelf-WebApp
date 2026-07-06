import { useMemo, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import {
  getListeningSessions,
  type ListeningSession,
  type ListeningSessionsPage,
} from '@/api/absLibrary'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { formatTimestamp, fmtSessDate, classifyDevice } from '@hearthshelf/core'
import { Cover, tintFor } from '@/components/shared/Cover'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'

const ITEMS_PER_PAGE = 25

export function SessionsPage() {
  const { target } = useActiveServer()
  const ui = useMediaUI()
  const [page, setPage] = useState(0)

  const { data, isLoading, isError, refetch, isFetching } = useQuery<ListeningSessionsPage>({
    queryKey: ['abs-sessions', target?.serverId, page],
    queryFn: () => getListeningSessions(target!, { page, itemsPerPage: ITEMS_PER_PAGE }),
    enabled: Boolean(target),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  })

  const sessions = useMemo(() => data?.sessions ?? [], [data])
  const numPages = Math.max(1, data?.numPages ?? 1)

  // Summary tiles (client-derived from the loaded page of sessions).
  const totalListened = sessions.reduce((s, x) => s + (x.timeListeningSec ?? 0), 0)
  const uniqueBooks = new Set(sessions.map((s) => s.itemId)).size
  const longest = sessions.reduce((m, s) => Math.max(m, s.timeListeningSec ?? 0), 0)

  // Group sessions by day (array is already newest-first).
  const groups = useMemo(() => {
    const out: { day: string; rows: ListeningSession[] }[] = []
    for (const s of sessions) {
      const { day } = fmtSessDate(s.startedAt)
      const last = out[out.length - 1]
      if (last && last.day === day) last.rows.push(s)
      else out.push({ day, rows: [s] })
    }
    return out
  }, [sessions])

  if (!target) return null

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div className="eyebrow">Insights</div>
        <h1 className="title-xl">Listening history</h1>
        <p className="page-sub">
          Every session, newest first. Jump straight back to any book you were in.
        </p>
      </div>

      {isLoading && <LoadingSpinner className="py-12" label="Loading history..." />}

      {isError && !data && <ErrorState message="Could not load your history." onRetry={refetch} />}

      {data && sessions.length === 0 && (
        <div className="empty-state">
          <Icon name="history" />
          <h3>No listening yet</h3>
          <p>Your sessions will appear here as you listen.</p>
        </div>
      )}

      {sessions.length > 0 && (
        <>
          <div className="stat-tiles">
            <div className="tile">
              <div className="t-ico">
                <Icon name="history" />
              </div>
              <div className="t-num">{data?.total ?? sessions.length}</div>
              <div className="t-cap">Sessions</div>
            </div>
            <div className="tile">
              <div className="t-ico">
                <Icon name="schedule" />
              </div>
              <div className="t-num">{Math.round(totalListened / 3600)}h</div>
              <div className="t-cap">This page</div>
            </div>
            <div className="tile">
              <div className="t-ico">
                <Icon name="menu_book" />
              </div>
              <div className="t-num">{uniqueBooks}</div>
              <div className="t-cap">Books</div>
            </div>
            <div className="tile">
              <div className="t-ico">
                <Icon name="timer" />
              </div>
              <div className="t-num" style={{ fontFamily: 'var(--font-mono)' }}>
                {formatTimestamp(longest)}
              </div>
              <div className="t-cap">Longest session</div>
            </div>
          </div>

          <div style={isFetching ? { opacity: 0.6 } : undefined}>
            {groups.map((g) => (
              <div className="section" key={g.day}>
                <div className="sh-day">{g.day}</div>
                <div className="sh-list">
                  {g.rows.map((s) => {
                    const when = fmtSessDate(s.startedAt)
                    const dev = classifyDevice(s.deviceInfo)
                    return (
                      <div
                        className="sh-row"
                        key={s.id}
                        data-cv={tintFor(s.title)}
                        onClick={() => ui.openItem(s.itemId)}
                        title="Open book"
                      >
                        <Cover itemId={s.itemId} title={s.title} fs={3} />
                        <div className="sh-meta">
                          <div className="ll-title">{s.title}</div>
                          <div className="ll-sub">{s.author}</div>
                        </div>
                        <span className="sh-dur">{formatTimestamp(s.timeListeningSec)}</span>
                        <span className="sh-when">
                          <Icon
                            name={dev.icon}
                            style={{ fontSize: 15 }}
                            title={s.device ? `${dev.label} - ${s.device}` : dev.label}
                          />
                          {when.time}
                        </span>
                        <button
                          className="sh-play"
                          title="Open book"
                          onClick={(e) => {
                            e.stopPropagation()
                            ui.openItem(s.itemId)
                          }}
                        >
                          <Icon name="arrow_forward" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {numPages > 1 && (
            <div className="toolbar2" style={{ justifyContent: 'center', marginTop: 'var(--s6)' }}>
              <button
                className="pill"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <Icon name="chevron_left" /> Previous
              </button>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Page {page + 1} of {numPages}
              </span>
              <button
                className="pill"
                disabled={page + 1 >= numPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <Icon name="chevron_right" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
