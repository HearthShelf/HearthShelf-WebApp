import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { useCollections } from '@/hooks/useLibrary'
import { createCollection } from '@/api/absLibrary'
import { BookPickerModal } from '@/components/library/BookPickerModal'
import { Icon } from '@/components/common/Icon'

export function CollectionsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { target, connected, activeId } = useActiveLibrary()
  const [creating, setCreating] = useState(false)

  const { data, isLoading, isError, refetch } = useCollections(
    target ?? { serverId: '', serverUrl: '' },
    activeId ?? undefined,
    Boolean(target) && connected,
  )

  if (!target) return null

  const collections = data ?? []

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div className="eyebrow">Hand-built shelves</div>
        <h1 className="title-xl">Collections</h1>
        {data && (
          <p className="page-sub">
            {collections.length} {collections.length === 1 ? 'collection' : 'collections'}
          </p>
        )}
      </div>

      <div className="toolbar2">
        <span className="count-badge">
          {collections.length} {collections.length === 1 ? 'collection' : 'collections'}
        </span>
        <div className="tb-spacer" />
        <button className="pill" onClick={() => setCreating(true)} disabled={!activeId}>
          <Icon name="add" /> New collection
        </button>
      </div>

      {isLoading && <p className="page-sub">Loading collections...</p>}
      {isError && (
        <div className="empty-state">
          <Icon name="error" />
          <h3>Could not load collections.</h3>
          <button
            className="btn-sm btn-ghost"
            style={{ margin: '0 auto' }}
            onClick={() => refetch()}
          >
            Try again
          </button>
        </div>
      )}

      {data && collections.length === 0 && (
        <div className="empty-state">
          <Icon name="folder_special" />
          <h3>No collections yet</h3>
          <p>Group books into a shelf of your own. Start one with New collection.</p>
        </div>
      )}

      {collections.length > 0 && (
        <div className="coll-grid">
          {collections.map((c) => (
            <div key={c.id} className="coll-card" onClick={() => navigate(`/collections/${c.id}`)}>
              <div className="coll-stack">
                <div className="stack-more" style={{ borderRadius: 8, width: 72, height: 72 }}>
                  <Icon name="folder_special" />
                </div>
              </div>
              <div className="coll-meta">
                <h3>{c.name}</h3>
                <div className="coll-count">
                  <Icon name="auto_stories" /> {c.itemCount} {c.itemCount === 1 ? 'book' : 'books'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && activeId && (
        <BookPickerModal
          kind="collection"
          target={target}
          libraryId={activeId}
          mode="create"
          onSubmit={async (books, name) => {
            const made = await createCollection(target, activeId, name, books)
            void qc.invalidateQueries({
              queryKey: ['abs-collections', target.serverId, activeId],
            })
            if (made.id) navigate(`/collections/${made.id}`)
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  )
}
