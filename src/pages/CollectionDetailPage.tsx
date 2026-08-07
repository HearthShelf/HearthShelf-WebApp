import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { useCollection } from '@/hooks/useLibrary'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import {
  deleteCollection,
  removeBookFromCollection,
  updateCollection,
  type AbsListItem,
} from '@/api/absLibrary'
import { ItemGrid } from '@/components/ItemGrid'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Modal } from '@/components/common/Modal'
import { Icon } from '@/components/common/Icon'

/**
 * One collection, with the maintenance actions the page was previously missing:
 * rename, delete, and remove a book. Self-hosted has had these; hosted was
 * read-only even though ABS supports all three.
 *
 * A collection is LIBRARY-WIDE - deleting one takes it away from everyone on the
 * server, which is why the confirmations name the book count and say plainly
 * that the books themselves stay put. Removing a book must never read as
 * deleting the book.
 */
export function CollectionDetailPage() {
  const { collectionId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { target, connected, activeId } = useActiveLibrary()
  const ui = useMediaUI()

  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [removing, setRemoving] = useState<AbsListItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useCollection(
    target ?? { serverId: '', serverUrl: '' },
    collectionId,
    Boolean(target) && connected,
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
          <button
            className="btn-sm btn-ghost"
            style={{ margin: '0 auto' }}
            onClick={() => refetch()}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  const books = data.items
  const totalH = books.reduce((s, b) => s + (b.durationSec ?? 0) / 3600, 0)

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['abs-collection', target.serverId, data.id] })
    if (activeId)
      void qc.invalidateQueries({ queryKey: ['abs-collections', target.serverId, activeId] })
  }

  const doRename = async () => {
    const name = draftName.trim()
    if (!name || name === data.name) {
      setRenaming(false)
      return
    }
    setBusy(true)
    try {
      await updateCollection(target, data.id, { name })
      invalidate()
      setRenaming(false)
    } catch {
      setFailure('Could not rename that collection.')
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    setBusy(true)
    try {
      await deleteCollection(target, data.id)
      if (activeId)
        void qc.invalidateQueries({ queryKey: ['abs-collections', target.serverId, activeId] })
      navigate('/collections')
    } catch {
      setFailure('Could not delete that collection.')
      setBusy(false)
    }
  }

  const doRemove = async (book: AbsListItem) => {
    setBusy(true)
    try {
      await removeBookFromCollection(target, data.id, book.id)
      invalidate()
    } catch {
      setFailure('Could not remove that book.')
    } finally {
      setBusy(false)
      setRemoving(null)
    }
  }

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

      {failure && (
        <div className="empty-state" role="alert" style={{ padding: 'var(--s4)' }}>
          <p>{failure}</p>
          <button className="btn-sm btn-ghost" onClick={() => setFailure(null)}>
            Dismiss
          </button>
        </div>
      )}

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
        <button
          className="pill"
          onClick={() => {
            setDraftName(data.name)
            setRenaming(true)
          }}
        >
          <Icon name="edit" /> Rename
        </button>
        <button className="pill" onClick={() => setConfirmingDelete(true)}>
          <Icon name="delete" /> Delete
        </button>
      </div>

      {books.length === 0 ? (
        <div className="empty-state">
          <Icon name="auto_stories" />
          <h3>This collection is empty</h3>
        </div>
      ) : (
        <>
          <ItemGrid items={books} />
          {/* Removing lives in its own list rather than on the tiles: ItemGrid is
              shared with the library and search, and giving every tile in the app
              a remove affordance to serve this page would be the wrong trade. */}
          <details className="section" style={{ marginTop: 'var(--s6)' }}>
            <summary className="sh-day" style={{ cursor: 'pointer' }}>
              Remove a book from this collection
            </summary>
            <div className="sh-list">
              {books.map((b) => (
                <div className="sh-row" key={b.id}>
                  <div className="sh-meta">
                    <div className="ll-title">{b.title}</div>
                    <div className="ll-sub">{b.author}</div>
                  </div>
                  <button
                    className="btn-sm btn-ghost"
                    onClick={() => setRemoving(b)}
                    disabled={busy}
                  >
                    <Icon name="close" /> Remove
                  </button>
                </div>
              ))}
            </div>
          </details>
        </>
      )}

      {renaming && (
        <Modal
          title="Rename collection"
          onClose={() => setRenaming(false)}
          foot={
            <>
              <div style={{ flex: 1 }} />
              <button className="btn-sm btn-ghost" onClick={() => setRenaming(false)}>
                Cancel
              </button>
              <button
                className="btn-sm btn-green"
                onClick={() => void doRename()}
                disabled={busy || !draftName.trim()}
              >
                Save
              </button>
            </>
          }
        >
          <label className="fld-label" htmlFor="collection-name">
            Name
          </label>
          <input
            id="collection-name"
            className="fld"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') void doRename()
            }}
          />
        </Modal>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this collection?"
          message={`"${data.name}" holds ${books.length} ${
            books.length === 1 ? 'book' : 'books'
          }. Deleting it removes the collection for everyone on this server. The ${
            books.length === 1 ? 'book stays' : 'books stay'
          } in the library.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => void doDelete()}
          onClose={() => setConfirmingDelete(false)}
        />
      )}

      {removing && (
        <ConfirmDialog
          title="Remove from collection?"
          message={`Take "${removing.title}" out of the collection "${data.name}". It stays in your library.`}
          confirmLabel="Remove"
          danger
          onConfirm={() => void doRemove(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
