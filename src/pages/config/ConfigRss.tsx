import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRssFeeds, closeRssFeed, adminContentKeys } from '@/api/absAdmin'
import { useActiveServer } from '@/hooks/useActiveServer'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

// RSS feeds (read + close). ABS opens a feed per book/series/collection that an
// admin chooses to share; this lists the open ones and closes them.
export function ConfigRss() {
  const qc = useQueryClient()
  const { target } = useActiveServer()
  const { data } = useQuery({
    queryKey: adminContentKeys.rss(target?.serverId ?? ''),
    queryFn: () => getRssFeeds(target!),
    enabled: Boolean(target),
    staleTime: 30 * 1000,
  })
  const feeds = data?.feeds ?? []

  const close = async (id: string) => {
    if (!target) return
    await closeRssFeed(target, id)
    qc.invalidateQueries({ queryKey: adminContentKeys.rss(target.serverId) })
  }

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Admin</div>
        <h1 className="title-xl">RSS Feeds</h1>
        {data && <p className="page-sub">{feeds.length} open feeds</p>}
      </div>
      {!data ? (
        <LoadingSpinner className="py-12" label="Loading..." />
      ) : feeds.length === 0 ? (
        <div className="empty-state">
          <Icon name="rss_feed" />
          <h3>No open RSS feeds</h3>
          <p>Open a feed from a book, series, or collection to share it.</p>
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Feed</th>
                <th>Type</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {feeds.map((f) => (
                <tr key={f.id}>
                  <td style={{ fontWeight: 600 }}>{f.meta?.title ?? f.feedUrl}</td>
                  <td>{f.entityType}</td>
                  <td>
                    <div className="t-actions">
                      <button
                        className="tbl-icon"
                        title="Close feed"
                        onClick={() => void close(f.id)}
                      >
                        <Icon name="close" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
