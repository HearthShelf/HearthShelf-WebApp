import { useState, useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getMe,
  type AbsTarget,
  type AbsLibraryItem,
  type SeriesListResponse,
} from '@/api/absLibrary'
import { Icon } from '@/components/common/Icon'
import { AddToListModal } from '@/components/library/AddToListModal'
import { BatchEditModal } from '@/components/library/BatchEditModal'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { useMarkFinished } from '@/hooks/useMarkFinished'
import { useQueueStore } from '@/store/queueStore'

interface Pos {
  x: number
  y: number
}

interface BookContextMenuProps {
  item: AbsLibraryItem
  // The active server target, needed for admin gating + edit + add-to-list.
  target: AbsTarget
  progress?: number
  finished?: boolean
  authorId?: string
  seriesId?: string
  seriesName?: string
  onToast?: (msg: string) => void
  // Refresh the surrounding list after an edit (e.g. invalidate series query).
  onChanged?: () => void
  children: ReactNode
}

// Wraps any book card child. Right-clicking opens a positioned context menu with
// all book actions: detail, play/read, queue, collection, playlist, mark
// finished, navigation, and (for admins) edit metadata.
export function BookContextMenu({
  item,
  target,
  progress = 0,
  finished,
  authorId,
  seriesId,
  seriesName,
  onToast,
  onChanged,
  children,
}: BookContextMenuProps) {
  const [pos, setPos] = useState<Pos | null>(null)
  const [modalTab, setModalTab] = useState<'collection' | 'playlist' | null>(null)
  const [showEdit, setShowEdit] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const ui = useMediaUI()
  const { pathname } = useLocation()
  const onSeriesPage = pathname.startsWith('/series/')
  const qc = useQueryClient()

  // Resolve series ID from the TanStack Query cache when not explicitly provided.
  // Uses the cached series list (populated when the user visits Library -> Series)
  // so this is zero-cost and silent when the cache is cold.
  const resolvedSeriesId =
    seriesId ??
    (() => {
      const sn = item.media.metadata.seriesName
      if (!sn || !item.libraryId) return undefined
      const cached = qc.getQueryData<SeriesListResponse>([
        'library-series',
        target.serverId,
        item.libraryId,
      ])
      // seriesName carries the trailing "#n"; match on the bare series name.
      const bare = sn.replace(/\s*#?[\d.]+\s*$/, '').trim()
      return cached?.results.find((s) => s.name === bare || s.name === sn)?.id
    })()

  const { markFinished } = useMarkFinished()
  const addToQueue = useQueueStore((s) => s.add)

  // Admin gating: edit metadata is only offered when the signed-in user can
  // update items on this server.
  const { data: me } = useQuery({
    queryKey: ['abs-me', target.serverId],
    queryFn: () => getMe(target),
    enabled: Boolean(pos),
    staleTime: 5 * 60 * 1000,
  })
  const canEdit =
    me?.type === 'admin' || me?.type === 'root' || Boolean(me?.permissions?.update)

  const { title, authorName } = item.media.metadata
  const hasEbook = !!item.media.ebookFormat
  const hasAudio = item.media.numAudioFiles > 0

  const open = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setPos({ x: e.clientX, y: e.clientY })
  }

  const close = () => setPos(null)

  // Close on click-away / Escape.
  useEffect(() => {
    if (!pos) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [pos])

  // Clamp to the viewport after render so we know the menu's dimensions.
  useEffect(() => {
    if (!pos || !menuRef.current) return
    const { width, height } = menuRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const nx = Math.min(pos.x, vw - width - 8)
    const ny = Math.min(pos.y, vh - height - 8)
    if (nx !== pos.x || ny !== pos.y) setPos({ x: nx, y: ny })
  }, [pos])

  const act = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    close()
    fn()
  }

  const authorHref = authorId ? ui.authorHref?.(authorId) ?? `/author/${authorId}` : null

  const menu = pos && (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ctx-header">
        <span className="ctx-title">{title ?? 'Untitled'}</span>
        {authorName && <span className="ctx-author">{authorName}</span>}
      </div>
      <div className="ctx-divider" />

      <button className="mp-item" onClick={act(() => ui.openItem(item.id))}>
        <Icon name="info" /> View details
      </button>

      {hasAudio && (
        <button className="mp-item" onClick={act(() => ui.playItem(item.id))}>
          <Icon name="play_arrow" fill /> Play
        </button>
      )}

      {hasEbook && (
        <button className="mp-item" onClick={act(() => ui.openItem(item.id))}>
          <Icon name="menu_book" fill /> Read
        </button>
      )}

      <div className="ctx-divider" />

      <button
        className="mp-item"
        onClick={act(() => {
          addToQueue({ libraryItemId: item.id, title: title ?? 'Untitled', author: authorName })
          onToast?.(`Added "${title}" to queue`)
        })}
      >
        <Icon name="reorder" /> Add to queue
      </button>

      <button
        className="mp-item"
        disabled={!item.libraryId}
        onClick={act(() => setModalTab('collection'))}
      >
        <Icon name="folder_special" /> Add to collection
      </button>

      <button
        className="mp-item"
        disabled={!item.libraryId}
        onClick={act(() => setModalTab('playlist'))}
      >
        <Icon name="queue_music" /> Add to playlist
      </button>

      <div className="ctx-divider" />

      <button
        className={'mp-item' + (finished ? ' on' : '')}
        onClick={act(() => {
          void markFinished([item.id], !finished).then(() =>
            onToast?.(finished ? 'Marked not finished' : 'Marked finished')
          )
        })}
      >
        <Icon name="check_circle" fill={finished} />
        {finished ? 'Mark as unfinished' : 'Mark as finished'}
      </button>

      {progress > 0 && !finished && (
        <button className="mp-item" onClick={act(() => void markFinished([item.id], false))}>
          <Icon name="replay" /> Reset progress
        </button>
      )}

      {(authorId || (resolvedSeriesId && !onSeriesPage)) && (
        <>
          <div className="ctx-divider" />
          {resolvedSeriesId && !onSeriesPage && (
            <button
              className="mp-item"
              onClick={act(() =>
                navigate(ui.seriesHref?.(resolvedSeriesId) ?? `/series/${resolvedSeriesId}`)
              )}
            >
              <Icon name="collections_bookmark" /> Go to series
              {(seriesName ?? item.media.metadata.seriesName) && (
                <span className="mp-tail">{seriesName ?? item.media.metadata.seriesName}</span>
              )}
            </button>
          )}
          {authorHref && (
            <button className="mp-item" onClick={act(() => navigate(authorHref))}>
              <Icon name="person" /> Go to author
            </button>
          )}
        </>
      )}

      {canEdit && (
        <>
          <div className="ctx-divider" />
          <button className="mp-item" onClick={act(() => setShowEdit(true))}>
            <Icon name="edit" /> Edit metadata
          </button>
        </>
      )}
    </div>
  )

  return (
    <div onContextMenu={open} style={{ display: 'contents' }}>
      {children}
      {menu && createPortal(menu, document.body)}
      {modalTab && item.libraryId && (
        <AddToListModal
          libraryItemId={item.id}
          target={target}
          libraryId={item.libraryId}
          initialTab={modalTab}
          onClose={() => setModalTab(null)}
          onToast={onToast}
        />
      )}
      {showEdit && (
        <BatchEditModal
          ids={[item.id]}
          items={[item]}
          target={target}
          onClose={() => setShowEdit(false)}
          onDone={() => {
            setShowEdit(false)
            onChanged?.()
          }}
        />
      )}
    </div>
  )
}
