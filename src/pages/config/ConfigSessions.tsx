import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getSessions, deleteSession, adminSectionKeys, type ABSAdminSession } from '@/api/absAdmin'
import { useActiveServer } from '@/hooks/useActiveServer'
import { formatTimestamp, fmtSessDate } from '@hearthshelf/core'
import { Icon } from '@/components/common/Icon'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'

// All-users listening sessions (admin view).
export function ConfigSessions() {
  const qc = useQueryClient()
  const { target } = useActiveServer()
  const [pendingDelete, setPendingDelete] = useState<ABSAdminSession | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: adminSectionKeys.sessions(target?.serverId ?? '', 0),
    queryFn: () => getSessions(target!, 0, 50),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  const sessions = data?.sessions ?? []

  if (!target) return <LoadingSpinner className="py-12" label="Connecting..." />

  const doDelete = async (s: ABSAdminSession) => {
    await deleteSession(target, s.id)
    qc.invalidateQueries({ queryKey: adminSectionKeys.sessions(target.serverId, 0) })
  }

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Admin</div>
        <h1 className="title-xl">Listening Sessions</h1>
        {data && <p className="page-sub">{data.total} sessions server-wide</p>}
      </div>

      {isLoading && <LoadingSpinner className="py-12" label="Loading sessions..." />}
      {isError && <ErrorState message="Could not load sessions." onRetry={refetch} />}

      {data && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Book</th>
                <th>Listened</th>
                <th>When</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const when = fmtSessDate(s.startedAt)
                return (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{s.displayTitle}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {s.displayAuthor}
                      </div>
                    </td>
                    <td className="num">{formatTimestamp(s.timeListening)}</td>
                    <td className="num">
                      {when.day} · {when.time}
                    </td>
                    <td>
                      <div className="t-actions">
                        <button
                          className="tbl-icon"
                          title="Delete session"
                          onClick={() => setPendingDelete(s)}
                        >
                          <Icon name="delete" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete session"
          message={`Delete the listening session for "${pendingDelete.displayTitle}"? This only removes the history record, not the book.`}
          confirmLabel="Delete session"
          danger
          onConfirm={() => void doDelete(pendingDelete)}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </>
  )
}
