import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getPlaylists } from '@/api/absPlaylists'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { Cover, tintFor } from '@/components/shared/Cover'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'

export function PlaylistsPage() {
  const navigate = useNavigate()
  const { target } = useActiveServer()
  const { activeId } = useActiveLibrary()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['abs-playlists', target?.serverId, activeId],
    queryFn: () => getPlaylists(target as NonNullable<typeof target>, activeId as string),
    enabled: Boolean(target) && Boolean(activeId),
    staleTime: 2 * 60 * 1000,
  })

  const playlists = data ?? []

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div className="eyebrow">Your queues</div>
        <h1 className="title-xl">Playlists</h1>
        {data && (
          <p className="page-sub">
            {playlists.length} {playlists.length === 1 ? 'playlist' : 'playlists'}
          </p>
        )}
      </div>

      {isLoading && <LoadingSpinner className="py-12" label="Loading playlists..." />}
      {isError && <ErrorState message="Could not load playlists." onRetry={refetch} />}

      {data && playlists.length === 0 && (
        <div className="empty-state">
          <Icon name="queue_music" />
          <h3>No playlists yet</h3>
          <p>Playlists you build in your library show up here.</p>
        </div>
      )}

      {playlists.length > 0 && (
        <div className="coll-grid">
          {playlists.map((pl) => {
            const items = pl.items
            const extra = items.length - 4
            const cv = tintFor(items[0]?.title ?? pl.name)
            return (
              <button
                type="button"
                key={pl.id}
                className="coll-card"
                data-cv={cv}
                onClick={() => navigate(`/playlists/${pl.id}`)}
              >
                <div className="coll-stack">
                  {items.slice(0, 4).map((it) => (
                    <Cover
                      key={it.libraryItemId}
                      itemId={it.libraryItemId}
                      title={it.title}
                      fs={6}
                    />
                  ))}
                  {extra > 0 && <div className="stack-more">+{extra}</div>}
                </div>
                <div className="coll-meta">
                  <h3>{pl.name}</h3>
                  {pl.description && <p>{pl.description}</p>}
                  <div className="coll-count">
                    <Icon name="queue_music" /> {items.length}{' '}
                    {items.length === 1 ? 'item' : 'items'}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
