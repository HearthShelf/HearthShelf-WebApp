import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import {
  getListeningSessions,
  type ListeningSession,
  type ListeningSessionsPage,
} from '@/api/absLibrary'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { Cover, tintFor } from '@/components/shared/Cover'
import { Icon } from '@/components/common/Icon'

const ITEMS_PER_PAGE = 25

// Local time formatter (no shared util in this app). Renders e.g. "12h 30m".
function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h === 0) {
    if (m === 0) return `${Math.max(0, Math.round(sec))}s`
    return `${m}m`
  }
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

// "Started" shown relative to now (epoch ms). Falls back to a date for old rows.
function fmtRelative(epochMs: number): string {
  if (!epochMs) return ''
  const diff = Date.now() - epochMs
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(epochMs).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function deviceIcon(device: string | undefined): string {
  const d = (device ?? '').toLowerCase()
  if (d.includes('android') || d.includes('ios') || d.includes('phone')) return 'smartphone'
  if (d.includes('chrome') || d.includes('firefox') || d.includes('safari') || d.includes('edge'))
    return 'language'
  return 'computer'
}

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

  if (!target) return null

  const sessions = data?.sessions ?? []
  const numPages = Math.max(1, data?.numPages ?? 1)

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div className="eyebrow">Insights</div>
        <h1 className="title-xl">Listening history</h1>
        <p className="page-sub">Every session, newest first.</p>
      </div>

      {isLoading && <p className="page-sub">Loading history...</p>}

      {isError && !data && (
        <div className="empty-state">
          <Icon name="error" />
          <h3>Could not load your history</h3>
          <button
            className="btn-sm btn-ghost"
            style={{ margin: '0 auto' }}
            onClick={() => refetch()}
          >
            Try again
          </button>
        </div>
      )}

      {data && sessions.length === 0 && (
        <div className="empty-state">
          <Icon name="history" />
          <h3>No listening yet</h3>
          <p>Your sessions will appear here as you listen.</p>
        </div>
      )}

      {sessions.length > 0 && (
        <>
          <div className="section">
            <div className="sh-list" style={isFetching ? { opacity: 0.6 } : undefined}>
              {sessions.map((s: ListeningSession) => (
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
                  <span className="sh-span">{fmtRelative(s.startedAt)}</span>
                  <span className="sh-dur">{fmtDuration(s.timeListeningSec)}</span>
                  <span className="sh-when">
                    <Icon name={deviceIcon(s.device)} style={{ fontSize: 15 }} />
                    {s.device ?? 'Web'}
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
              ))}
            </div>
          </div>

          {numPages > 1 && (
            <div
              className="toolbar2"
              style={{ justifyContent: 'center', marginTop: 'var(--s6)' }}
            >
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
