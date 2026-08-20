/**
 * Right-click menu for a book inside a club: the queue rows, past reads, and
 * set-aside cards all wrap their card in this instead of carrying their own
 * buttons. Which actions appear depends on where the book sits in the club, so
 * the caller passes only the handlers that make sense for that slot.
 *
 * Same conventions as BookContextMenu (portal, .ctx-menu classes, click-away +
 * Escape, viewport clamping); this one is deliberately small because a club
 * book has no library-item machinery behind it - just a title and an id.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { HSClubBook } from '@hearthshelf/core'
import { Icon } from '@/components/common/Icon'
import { useMediaUI } from '@/components/shared/MediaUIContext'

interface Pos {
  x: number
  y: number
}

export interface ClubBookMenuAction {
  label: string
  icon: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
}

export function ClubBookMenu({
  book,
  actions,
  children,
}: {
  book: HSClubBook
  /** Club-slot actions, in menu order. Empty entries are skipped, so a caller
   * can build the list conditionally without filtering first. */
  actions: Array<ClubBookMenuAction | false | null | undefined>
  children: ReactNode
}) {
  const [pos, setPos] = useState<Pos | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const ui = useMediaUI()

  const close = () => setPos(null)

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

  // Clamp to the viewport once the menu's real size is known.
  useEffect(() => {
    if (!pos || !menuRef.current) return
    const { width, height } = menuRef.current.getBoundingClientRect()
    const nx = Math.min(pos.x, window.innerWidth - width - 8)
    const ny = Math.min(pos.y, window.innerHeight - height - 8)
    if (nx !== pos.x || ny !== pos.y) setPos({ x: nx, y: ny })
  }, [pos])

  const open = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setPos({ x: e.clientX, y: e.clientY })
  }

  const act = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    close()
    fn()
  }

  const items = actions.filter(Boolean) as ClubBookMenuAction[]

  const menu = pos && (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ctx-header">
        <span className="ctx-title">{book.title || 'Untitled'}</span>
        {book.author && <span className="ctx-author">{book.author}</span>}
      </div>
      <div className="ctx-divider" />

      <button className="mp-item" onClick={act(() => ui.openItem(book.libraryItemId))}>
        <Icon name="info" /> View details
      </button>
      <button className="mp-item" onClick={act(() => ui.playItem(book.libraryItemId))}>
        <Icon name="play_arrow" fill /> Play
      </button>

      {items.length > 0 && <div className="ctx-divider" />}

      {items.map((action) => (
        <button
          key={action.label}
          className={action.danger ? 'mp-item danger' : 'mp-item'}
          disabled={action.disabled}
          onClick={act(action.onSelect)}
        >
          <Icon name={action.icon} /> {action.label}
        </button>
      ))}
    </div>
  )

  return (
    <div onContextMenu={open} style={{ display: 'contents' }}>
      {children}
      {menu && createPortal(menu, document.body)}
    </div>
  )
}
