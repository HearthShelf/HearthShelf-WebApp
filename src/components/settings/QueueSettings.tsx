import { useQuery } from '@tanstack/react-query'
import { useSettingsStore, type AutoRulePref } from '@/store/settingsStore'
import type { QueueMode, AutoRuleId } from '@/store/queueStore'
import { useQueueStore } from '@/store/queueStore'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { getPlaylistsList } from '@/api/absLibrary'
import { Icon } from '@/components/common/Icon'
import { SetRow, Seg } from '@/components/settings/controls'

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
    desc: 'Queue unread books from any series you have begun but not completed.',
  },
  'book-club': {
    title: 'Books your clubs are reading',
    desc: 'Queue the current pick from each of your book clubs.',
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
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= rules.length) return
    const next = rules.slice()
    const [moved] = next.splice(i, 1)
    next.splice(j, 0, moved)
    onChange(next)
  }
  return (
    <div className="cfg-card">
      {rules.map((r, i) => {
        const meta = RULE_LABELS[r.id]
        return (
          <div className="cfg-line" key={r.id}>
            <Icon name="drag_indicator" style={{ color: 'var(--text-muted)' }} />
            <div className="cl-meta" style={{ flex: 1 }}>
              <div className="cl-t">{meta.title}</div>
              <div className="cl-d">{meta.desc}</div>
            </div>
            <button className="btn-sm btn-ghost" disabled={i === 0} onClick={() => move(i, -1)}>
              Up
            </button>
            <button
              className="btn-sm btn-ghost"
              disabled={i === rules.length - 1}
              onClick={() => move(i, 1)}
            >
              Down
            </button>
            <Toggle on={r.on} onChange={() => toggle(i)} />
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
            desc="Use Up/Down to set priority. The queue fills from the top rule down."
            control={null}
            stacked
          >
            <RuleList rules={s.queueAutoRules} onChange={(r) => set('queueAutoRules', r)} />
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
