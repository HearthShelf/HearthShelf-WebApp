import { Play, Check, BookOpen } from 'lucide-react'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { AvatarStack } from '@/components/common/AvatarStack'
import { useReadersOf, useReadersTarget } from '@/components/shared/ReadersContext'

/**
 * Pure, shareable library tile: cover + title + author + optional progress, with
 * hover play / mark-finished actions. Knows NOTHING about routing, the player,
 * auth, or data fetching — it reads those capabilities from MediaUIProvider, so
 * the same component works in both the HearthShelf app and this WebApp.
 *
 * Data comes in as plain props (no ABS type import), so it's decoupled from any
 * one app's API client too.
 */
export interface BookTileItem {
  id: string
  title: string
  author?: string
  /** 0..1 listening progress; renders the bar when >0 and not finished. */
  progress?: number
  finished?: boolean
}

export function BookTile({ item }: { item: BookTileItem }) {
  const ui = useMediaUI()
  const cover = ui.coverUrl(item.id)
  const readers = useReadersOf(item.id)
  const readersTarget = useReadersTarget()

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
  }

  return (
    <div className="group cursor-pointer" onClick={() => ui.openItem(item.id)}>
      <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-secondary transition-colors group-hover:border-primary">
        {cover ? (
          // eslint-disable-next-line jsx-a11y/img-redundant-alt
          <img src={cover} alt={item.title} loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <BookOpen size={24} />
          </div>
        )}

        {/* Hover actions: play + (optional) mark finished. */}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1.5 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
          {ui.markFinished && (
            <button
              onClick={stop(() => ui.markFinished?.(item.id, !item.finished))}
              aria-label={item.finished ? 'Mark not finished' : 'Mark finished'}
              className="flex size-8 items-center justify-center rounded-full bg-card/90 text-foreground hover:bg-card"
            >
              <Check size={15} className={item.finished ? 'text-primary' : ''} />
            </button>
          )}
          <button
            onClick={stop(() => ui.playItem(item.id))}
            aria-label="Play"
            className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90"
          >
            <Play size={15} fill="currentColor" />
          </button>
        </div>

        {item.finished && (
          <span className="absolute left-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check size={12} />
          </span>
        )}
      </div>

      <p className="mt-2 line-clamp-2 text-[13px] font-medium text-card-foreground">{item.title}</p>
      {item.author && <p className="t-muted line-clamp-1 text-[12px]">{item.author}</p>}

      {item.progress != null && item.progress > 0 && !item.finished && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-elevated">
          <div
            className="h-full bg-primary"
            style={{ width: `${Math.min(100, item.progress * 100)}%` }}
          />
        </div>
      )}

      {readers.length > 0 && (
        <div className="mt-2">
          <AvatarStack users={readers} target={readersTarget} max={4} size={21} />
        </div>
      )}
    </div>
  )
}
