import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getPlaylist } from '@/api/absPlaylists'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { Cover, tintFor } from '@/components/shared/Cover'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'

export function PlaylistDetailPage() {
  const { playlistId } = useParams()
  const navigate = useNavigate()
  const { target } = useActiveServer()
  const ui = useMediaUI()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['abs-playlist', target?.serverId, playlistId],
    queryFn: () => getPlaylist(target as NonNullable<typeof target>, playlistId as string),
    enabled: Boolean(target) && Boolean(playlistId),
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading) {
    return (
      <div className="page">
        <LoadingSpinner className="py-12" label="Loading playlist..." />
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="page">
        <ErrorState message="Could not load this playlist." onRetry={refetch} />
      </div>
    )
  }

  const items = data.items
  const cv = tintFor(items[0]?.title ?? data.name)

  return (
    <div className="page fade-in" style={{ ['--glow-accent' as string]: cv }}>
      <div className="crumb">
        <Link className="lnk" to="/playlists">
          Playlists
        </Link>
        <Icon name="chevron_right" />
        {data.name}
      </div>

      <div className="page-head">
        <div className="eyebrow">Playlist</div>
        <h1 className="title-xl">{data.name}</h1>
        {data.description && <p className="page-sub">{data.description}</p>}
      </div>

      <div className="toolbar2">
        <span className="count-badge">
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
        <div className="tb-spacer" />
        {items[0] && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => ui.playItem(items[0].libraryItemId)}
          >
            <Icon name="play_arrow" fill /> Play
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <Icon name="queue_music" />
          <h3>This playlist is empty</h3>
        </div>
      ) : (
        <div className="pl-list">
          {items.map((it) => (
            <button
              type="button"
              className="pl-row"
              key={it.libraryItemId}
              data-cv={tintFor(it.title)}
              onClick={() => navigate(`/book/${it.libraryItemId}`)}
            >
              <Cover itemId={it.libraryItemId} title={it.title} fs={5} />
              <div style={{ minWidth: 0 }}>
                <div className="ll-title">{it.title}</div>
                <div className="ll-sub">{it.author}</div>
              </div>
              <span
                className="ll-play"
                onClick={(e) => {
                  e.stopPropagation()
                  ui.playItem(it.libraryItemId)
                }}
                aria-label="Play"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    ui.playItem(it.libraryItemId)
                  }
                }}
              >
                <Icon name="play_arrow" fill />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
