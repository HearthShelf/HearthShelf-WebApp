import { useCallback, useMemo } from 'react'
import type { QueueEntry } from '@hearthshelf/core'
import { useQueueStore } from '@/store/queueStore'
import { Cover } from '@/components/shared/Cover'
import { Icon } from '@/components/common/Icon'
import { usePointerReorder } from '@/hooks/usePointerReorder'

// Shared editor for the up-next queue, used by the player Up-next panel and the
// Queue settings page. In Manual mode it's the durable hand-queued list. In Auto
// mode it's ONE merged list: rule-generated picks carry a lightning bolt (read-
// only), hand-added books keep their drag handle + remove inline where they sit,
// and dragging a hand-added book reorders the manual books among themselves.
//
// `onPlay` is optional: Settings has no player to jump to, so it omits it and
// the rows aren't click-to-play there.
export function ManualQueueEditor({
  mode,
  onPlay,
}: {
  mode: 'manual' | 'auto'
  onPlay?: (id: string) => void
}) {
  const items = useQueueStore((s) => s.items)
  const manual = useQueueStore((s) => s.manual)
  const remove = useQueueStore((s) => s.remove)
  const reorder = useQueueStore((s) => s.reorder)
  const reorderManual = useQueueStore((s) => s.reorderManual)

  // The list shown: in Auto mode the merged queue; in Manual mode the hand list.
  const list = mode === 'auto' ? items : manual
  const manualIds = useMemo(() => new Set(manual.map((m) => m.libraryItemId)), [manual])

  // A drag in the merged Auto list reorders only the hand-added rows among
  // themselves; in Manual mode it's a plain reorder of the whole list.
  const reorderMerged = useCallback(
    (from: number, to: number) => {
      const merged = items.slice()
      const [moved] = merged.splice(from, 1)
      merged.splice(to, 0, moved)
      reorderManual(merged.filter((e: QueueEntry) => manualIds.has(e.libraryItemId)))
    },
    [items, manualIds, reorderManual],
  )
  const { dragIndex, overIndex, getRowProps } = usePointerReorder(
    list.length,
    mode === 'auto' ? reorderMerged : reorder,
  )

  if (list.length === 0) {
    return (
      <div className="pop-empty" style={{ padding: '4px 4px 8px' }}>
        {mode === 'auto'
          ? 'Nothing queued yet. Books you add with "Add to list" show up here too.'
          : 'Nothing queued. Add books with "Add to list".'}
      </div>
    )
  }

  return (
    <div>
      {list.map((q, i) => {
        // In Auto mode only hand-added rows are draggable/removable; the rest are
        // rule-generated (bolt marker). Manual mode: every row is the hand list.
        const editable = mode === 'manual' || manualIds.has(q.libraryItemId)
        const { style, ...rowProps } = getRowProps(i)
        return (
          <div
            className={'queue-row' + (editable && dragIndex === i ? ' dragging' : '')}
            key={q.libraryItemId}
            {...(editable ? rowProps : {})}
            style={{
              ...(editable ? style : {}),
              opacity: editable && dragIndex === i ? 0.5 : 1,
              borderTop:
                editable && overIndex === i && dragIndex !== i
                  ? '2px solid var(--primary)'
                  : undefined,
            }}
          >
            {editable ? (
              <span className="q-handle" title="Drag to reorder">
                <Icon name="drag_indicator" />
              </span>
            ) : (
              <span className="q-handle" style={{ cursor: 'default' }} />
            )}
            <Cover itemId={q.libraryItemId} title={q.title} fs={3} />
            <div
              className="q-meta"
              style={onPlay ? { cursor: 'pointer' } : undefined}
              // Tapping to play shouldn't start a drag; the surrounding row still
              // drags from the handle, cover, and empty space.
              onClick={onPlay ? () => onPlay(q.libraryItemId) : undefined}
            >
              <div className="q-t">{q.title}</div>
              <div className="q-s">{q.author}</div>
            </div>
            {editable ? (
              <span
                className="bm-x"
                title="Remove"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => remove(q.libraryItemId)}
              >
                <Icon name="close" />
              </span>
            ) : (
              <span
                className="q-handle"
                style={{ cursor: 'default', color: 'var(--accent)' }}
                title="Added automatically by your Auto rules"
              >
                <Icon name="bolt" />
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
