import { useParams, Link } from 'react-router-dom'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { useCollection } from '@/hooks/useLibrary'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { ItemGrid } from '@/components/ItemGrid'
import { Icon } from '@/components/common/Icon'

export function CollectionDetailPage() {
  const { collectionId } = useParams()
  const { target, connected } = useActiveLibrary()
  const ui = useMediaUI()

  const { data, isLoading, isError, refetch } = useCollection(
    target ?? { serverId: '', serverUrl: '' },
    collectionId,
    Boolean(target) && connected
  )

  if (!target) return null

  if (isLoading) {
    return (
      <div className="page">
        <p className="page-sub">Loading collection...</p>
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="page">
        <div className="empty-state">
          <Icon name="error" />
          <h3>Could not load this collection.</h3>
          <button className="btn-sm btn-ghost" style={{ margin: '0 auto' }} onClick={() => refetch()}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  const books = data.items
  const totalH = books.reduce((s, b) => s + (b.durationSec ?? 0) / 3600, 0)

  return (
    <div className="page fade-in">
      <div className="crumb">
        <Link className="lnk" to="/collections">
          Collections
        </Link>
        <Icon name="chevron_right" />
        {data.name}
      </div>

      <div className="page-head">
        <div className="eyebrow">Collection</div>
        <h1 className="title-xl">{data.name}</h1>
        {data.description && <p className="page-sub">{data.description}</p>}
      </div>

      <div className="toolbar2">
        <span className="count-badge">
          {books.length} {books.length === 1 ? 'book' : 'books'} · {totalH.toFixed(0)}h
        </span>
        <div className="tb-spacer" />
        {books[0] && (
          <button className="pill" onClick={() => ui.playItem(books[0].id)}>
            <Icon name="play_arrow" fill /> Play all
          </button>
        )}
      </div>

      {books.length === 0 ? (
        <div className="empty-state">
          <Icon name="auto_stories" />
          <h3>This collection is empty</h3>
        </div>
      ) : (
        <ItemGrid items={books} />
      )}
    </div>
  )
}
