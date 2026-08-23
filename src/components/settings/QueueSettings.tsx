import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSettingsStore, type AutoRulePref } from '@/store/settingsStore'
import type { QueueMode, AutoRuleId } from '@/store/queueStore'
import { useQueueStore } from '@/store/queueStore'
import { useDismissalsStore } from '@/store/dismissalsStore'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import {
  getPlaylistsList,
  getAllLibraryItems,
  getSeriesList,
  itemCoverUrl,
} from '@/api/absLibrary'
import { Icon } from '@/components/common/Icon'
import { SetRow, Seg } from '@/components/settings/controls'
import { ManualQueueEditor } from '@/components/player/ManualQueueEditor'
import { AutoQueueInfo } from '@/components/settings/AutoQueueInfo'
import { usePointerReorder } from '@/hooks/usePointerReorder'

const QUEUE_MODES: { value: QueueMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'manual', label: 'Manual' },
  { value: 'auto', label: 'Auto' },
  { value: 'playlist', label: 'Playlist' },
]
const RULE_LABELS: Record<AutoRuleId, { title: string; desc: string }> = {
  'finish-series': {
    title: 'Finish current series',
    desc: 'Queue the next book in the series you are listening to.',
  },
  'in-progress': {
    title: 'Anything in progress',
    desc: 'Queue other books you have started but not finished.',
  },
  'new-in-series': {
    title: 'New book in a started series',
    desc: 'Queue the next book from each series you have begun but not finished.',
  },
  'new-in-series-all': {
    title: 'Include every book in the series',
    desc: 'Instead of just the next one, queue all the books left in each series you started.',
  },
  'book-club': {
    title: 'Books your clubs are reading',
    desc: 'Queue the current pick from each of your book clubs.',
  },
  manual: {
    title: 'Books you queued by hand',
    desc: 'Queue the books you added yourself. Drag to set where they land.',
  },
}

function RuleList({
  rules,
  onChange,
}: {
  rules: AutoRulePref[]
  onChange: (rules: AutoRulePref[]) => void
}) {
  const toggle = (i: number) =>
    onChange(rules.map((r, idx) => (idx === i ? { ...r, on: !r.on } : r)))
  const reorder = (from: number, to: number) => {
    const next = rules.slice()
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }
  const { dragIndex, overIndex, getRowProps } = usePointerReorder(rules.length, reorder)
  return (
    <div className="cfg-card">
      {rules.map((r, i) => {
        const meta = RULE_LABELS[r.id]
        const { style, ...rowProps } = getRowProps(i)
        // new-in-series-all is a sub-modifier of new-in-series: indent it and
        // dim/disable it while the parent is off (it does nothing on its own).
        const isSub = r.id === 'new-in-series-all'
        const parentOff = isSub && !rules.find((x) => x.id === 'new-in-series')?.on
        return (
          <div
            className={'cfg-line' + (dragIndex === i ? ' dragging' : '')}
            key={r.id}
            {...rowProps}
            style={{
              ...style,
              opacity: dragIndex === i ? 0.5 : parentOff ? 0.45 : 1,
              paddingLeft: isSub ? 28 : undefined,
              borderTop:
                overIndex === i && dragIndex !== i ? '2px solid var(--primary)' : undefined,
            }}
          >
            <Icon name="drag_indicator" style={{ color: 'var(--text-muted)' }} />
            <div className="cl-meta" style={{ flex: 1 }}>
              <div className="cl-t">{meta.title}</div>
              <div className="cl-d">{meta.desc}</div>
            </div>
            {/* Stop the pointer-down from starting a drag when toggling. */}
            <span onPointerDown={(e) => e.stopPropagation()}>
              <Toggle on={r.on} onChange={() => !parentOff && toggle(i)} />
            </span>
          </div>
        )
      })}
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={'toggle' + (on ? ' on' : '')}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <i />
    </button>
  )
}

function PlaylistPicker() {
  const { target, activeId } = useActiveLibrary()
  const playlistId = useQueueStore((s) => s.playlistId)
  const setPlaylistId = useQueueStore((s) => s.setPlaylistId)
  const { data = [] } = useQuery({
    queryKey: ['settings-playlists', target?.serverId, activeId],
    queryFn: () => getPlaylistsList(target!, activeId!),
    enabled: Boolean(target && activeId),
    staleTime: 2 * 60 * 1000,
  })
  if (!target || !activeId) return <span className="badge-pill">No active library</span>
  if (data.length === 0) return <span className="badge-pill">No playlists yet</span>
  return (
    <select
      className="fld"
      style={{ maxWidth: 260 }}
      value={playlistId ?? ''}
      onChange={(e) => setPlaylistId(e.target.value || null)}
    >
      <option value="">Choose a playlist...</option>
      {data.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  )
}

export function QueueSettings() {
  const s = useSettingsStore()
  const set = s.set
  const setQueueStoreMode = useQueueStore((q) => q.setMode)
  const setQueueMode = (mode: QueueMode) => {
    set('queueMode', mode)
    setQueueStoreMode(mode)
  }

  return (
    <section>
      <div className="section-head">
        <Icon name="queue_music" />
        <h2>Queue</h2>
      </div>
      <div className="set-group">
        <SetRow
          title="When a book ends"
          desc="Off stops; Manual plays your queue; Auto builds up-next from rules; Playlist follows a chosen playlist."
          control={
            <Seg<QueueMode> value={s.queueMode} onChange={setQueueMode} options={QUEUE_MODES} />
          }
        />
        {s.queueMode === 'auto' && (
          <SetRow
            title="Auto rules"
            desc="Drag to set priority. The queue fills from the top rule down."
            control={null}
            stacked
          >
            <RuleList rules={s.queueAutoRules} onChange={(r) => set('queueAutoRules', r)} />
            <AutoQueueInfo />
          </SetRow>
        )}
        {(s.queueMode === 'manual' || s.queueMode === 'auto') && (
          <SetRow
            title={s.queueMode === 'auto' ? 'Your queue' : 'Manual queue'}
            desc={
              s.queueMode === 'auto'
                ? 'Auto picks are shown grayed out. Drag or remove the books you queued by hand below.'
                : 'Drag to set the order, or remove a book.'
            }
            control={null}
            stacked
          >
            <ManualQueueEditor mode={s.queueMode} />
          </SetRow>
        )}
        {s.queueMode === 'playlist' && (
          <SetRow
            title="Playlist to follow"
            desc="Playlist mode plays through this playlist in order."
            control={<PlaylistPicker />}
          />
        )}
        <IgnoredAndSetAside />
      </div>
    </section>
  )
}

// The user's ignored series and set-aside books, each with a Restore button.
// Ids alone are meaningless to a reader, so resolve them to real titles and
// covers from the library, and page the list instead of dumping every row.
const IGNORED_PAGE = 8

interface IgnoredRow {
  kind: 'series' | 'item'
  id: string
  title: string
  sub: string
  cover: string | null
}

function IgnoredAndSetAside() {
  const { target, activeId } = useActiveLibrary()
  const seriesIds = useDismissalsStore((s) => s.seriesIds)
  const itemIds = useDismissalsStore((s) => s.itemIds)
  const labels = useDismissalsStore((s) => s.labels)
  const hydrate = useDismissalsStore((s) => s.hydrate)
  const restore = useDismissalsStore((s) => s.restore)
  const [tab, setTab] = useState<'item' | 'series'>('item')
  const [page, setPage] = useState(0)

  useEffect(() => {
    if (target) void hydrate(target)
  }, [target, hydrate])

  const enabled = Boolean(target && activeId)
  const { data: items = [] } = useQuery({
    queryKey: ['ignored-items', target?.serverId, activeId],
    queryFn: () => getAllLibraryItems(target!, activeId!),
    enabled: enabled && itemIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })
  const { data: seriesList = [] } = useQuery({
    queryKey: ['ignored-series', target?.serverId, activeId],
    queryFn: () => getSeriesList(target!, activeId!),
    enabled: enabled && seriesIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  const rows: IgnoredRow[] = useMemo(() => {
    const byItem = new Map(items.map((i) => [i.id, i]))
    const bySeries = new Map(seriesList.map((s) => [s.id, s]))
    const books: IgnoredRow[] = itemIds.map((id) => {
      const it = byItem.get(id)
      return {
        kind: 'item',
        id,
        title: it?.title ?? labels[id] ?? 'Book no longer in this library',
        sub: it?.author ?? '',
        cover: target ? itemCoverUrl(target, id, 96) : null,
      }
    })
    const series: IgnoredRow[] = seriesIds.map((id) => ({
      kind: 'series',
      id,
      title: bySeries.get(id)?.name ?? labels[id] ?? 'Series no longer in this library',
      sub: '',
      cover: null,
    }))
    const sort = (a: IgnoredRow, b: IgnoredRow) => a.title.localeCompare(b.title)
    return tab === 'item' ? books.sort(sort) : series.sort(sort)
  }, [tab, itemIds, seriesIds, items, seriesList, labels, target])

  // Restoring the last row on the final page would strand the user on an empty
  // page, so clamp whenever the row count shrinks under the current offset.
  const pageCount = Math.max(1, Math.ceil(rows.length / IGNORED_PAGE))
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1)
  }, [page, pageCount])

  if (!target || (seriesIds.length === 0 && itemIds.length === 0)) return null

  const shown = rows.slice(page * IGNORED_PAGE, page * IGNORED_PAGE + IGNORED_PAGE)

  return (
    <SetRow
      title="Ignored"
      desc="Series you ignored and books you set aside. They stay in your library - they just stop being suggested. Restore to have them recommended again."
      control={null}
      stacked
    >
      {/* SetRow drops `control` when stacked, so the switcher lives in the body. */}
      <div style={{ marginBottom: 10 }}>
        <Seg<'item' | 'series'>
          value={tab}
          onChange={(v) => {
            setTab(v)
            setPage(0)
          }}
          options={[
            { value: 'item', label: `Books (${itemIds.length})` },
            { value: 'series', label: `Series (${seriesIds.length})` },
          ]}
        />
      </div>
      <div className="rule-list">
        {shown.length === 0 && (
          <div className="cl-d" style={{ padding: '8px 2px' }}>
            {tab === 'item' ? 'No books set aside.' : 'No series ignored.'}
          </div>
        )}
        {shown.map((r) => (
          <div className="rule-row" key={`${r.kind}:${r.id}`} style={{ cursor: 'default' }}>
            {r.cover ? (
              <img
                src={r.cover}
                alt=""
                width={32}
                height={32}
                style={{ borderRadius: 6, objectFit: 'cover', flex: 'none' }}
              />
            ) : (
              <Icon name={r.kind === 'series' ? 'collections_bookmark' : 'menu_book'} />
            )}
            <div className="rule-meta" style={{ flex: 1 }}>
              <div className="rule-t">{r.title}</div>
              {r.sub && <div className="rule-d">{r.sub}</div>}
            </div>
            <button className="btn-ghost" onClick={() => void restore(target, r.kind, r.id)}>
              Restore
            </button>
          </div>
        ))}
      </div>
      {pageCount > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 10,
            marginTop: 10,
          }}
        >
          <button
            className="btn-ghost"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Back
          </button>
          <span className="cl-d">
            Page {page + 1} of {pageCount}
          </span>
          <button
            className="btn-ghost"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next
          </button>
        </div>
      )}
    </SetRow>
  )
}
