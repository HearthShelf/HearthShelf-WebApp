import { useQuery } from '@tanstack/react-query'
import { useSettingsStore, type AutoRulePref } from '@/store/settingsStore'
import type { QueueMode, AutoRuleId } from '@/store/queueStore'
import { useQueueStore } from '@/store/queueStore'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { getPlaylistsList } from '@/api/absLibrary'
import { Icon } from '@/components/common/Icon'
import { SetRow, Seg } from '@/components/settings/controls'
import { ManualQueueEditor } from '@/components/player/ManualQueueEditor'
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
      </div>
    </section>
  )
}
