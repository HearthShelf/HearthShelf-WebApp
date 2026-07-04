import { useQuery } from '@tanstack/react-query'
import {
  useSettingsStore,
  type ScrubberScope,
  type CarMode,
  type AutoRulePref,
} from '@/store/settingsStore'
import type { QueueMode, AutoRuleId } from '@/store/queueStore'
import { useQueueStore } from '@/store/queueStore'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { getPlaylistsList } from '@/api/absLibrary'
import { Icon } from '@/components/common/Icon'
import { SetRow, Seg, Toggle, Slider, NumberInput } from '@/components/settings/controls'
import { isCarBrowser } from '@/hooks/useCarMode'

const SKIP_FWD_PRESETS = [15, 30, 60]
const SKIP_BACK_PRESETS = [10, 15, 30]
const SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 2]
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

export function PlaybackSettings() {
  const s = useSettingsStore()
  const set = s.set
  const setQueueStoreMode = useQueueStore((q) => q.setMode)
  const setQueueMode = (mode: QueueMode) => {
    set('queueMode', mode)
    setQueueStoreMode(mode)
  }
  const carDetected = isCarBrowser()
  const carDesc =
    s.carMode === 'auto'
      ? carDetected
        ? 'A car browser was detected, so car mode is on.'
        : 'Turns on car mode automatically when a car browser is detected. None detected here.'
      : s.carMode === 'on'
        ? 'Car mode is always on.'
        : 'Car mode is off.'

  return (
    <section>
      <div className="section-head">
        <Icon name="graphic_eq" />
        <h2>Playback</h2>
      </div>
      <div className="set-group">
        <SetRow
          title="Default speed"
          desc="The rate a fresh book starts at."
          control={
            <Seg<number>
              value={SPEED_PRESETS.includes(s.defaultSpeed) ? s.defaultSpeed : 0}
              onChange={(v) => (v === 0 ? set('defaultSpeed', 1) : set('defaultSpeed', v))}
              options={[
                ...SPEED_PRESETS.map((n) => ({ value: n, label: `${n}x` })),
                { value: 0, label: 'Custom' },
              ]}
            />
          }
        />
        {!SPEED_PRESETS.includes(s.defaultSpeed) && (
          <SetRow
            title="Custom default speed"
            control={
              <NumberInput
                value={s.defaultSpeed}
                min={0.5}
                max={3.5}
                suffix="x"
                onChange={(v) => set('defaultSpeed', v)}
              />
            }
          />
        )}
        <SetRow
          title="Progress bar"
          desc="Show the scrubber against the current chapter, or the whole book."
          control={
            <Seg<ScrubberScope>
              value={s.scrubber}
              onChange={(v) => set('scrubber', v)}
              options={[
                { value: 'chapter', label: 'Chapter' },
                { value: 'book', label: 'Book' },
              ]}
            />
          }
        />
        <SetRow
          title="Skip forward"
          desc="How far the forward button jumps."
          control={
            <div className="set-skip-row">
              <Seg<number>
                value={SKIP_FWD_PRESETS.includes(s.skipForward) ? s.skipForward : 0}
                onChange={(v) => {
                  if (v !== 0) {
                    set('skipForwardCustom', v)
                    set('skipForward', v)
                  }
                }}
                options={[
                  ...SKIP_FWD_PRESETS.map((n) => ({ value: n, label: `${n}s` })),
                  { value: 0, label: 'Custom' },
                ]}
              />
              {!SKIP_FWD_PRESETS.includes(s.skipForward) && (
                <NumberInput
                  value={s.skipForwardCustom}
                  min={5}
                  max={300}
                  suffix="s"
                  onChange={(v) => {
                    set('skipForwardCustom', v)
                    set('skipForward', v)
                  }}
                />
              )}
            </div>
          }
        />
        <SetRow
          title="Skip back"
          desc="How far the back button jumps."
          control={
            <div className="set-skip-row">
              <Seg<number>
                value={SKIP_BACK_PRESETS.includes(s.skipBack) ? s.skipBack : 0}
                onChange={(v) => {
                  if (v !== 0) {
                    set('skipBackCustom', v)
                    set('skipBack', v)
                  }
                }}
                options={[
                  ...SKIP_BACK_PRESETS.map((n) => ({ value: n, label: `${n}s` })),
                  { value: 0, label: 'Custom' },
                ]}
              />
              {!SKIP_BACK_PRESETS.includes(s.skipBack) && (
                <NumberInput
                  value={s.skipBackCustom}
                  min={5}
                  max={300}
                  suffix="s"
                  onChange={(v) => {
                    set('skipBackCustom', v)
                    set('skipBack', v)
                  }}
                />
              )}
            </div>
          }
        />
        <SetRow
          title="Hearth background"
          desc="Show the cozy hearth artwork behind the full-screen player."
          control={<Toggle on={s.hearthBgPlayer} onChange={(v) => set('hearthBgPlayer', v)} />}
        />
      </div>

      <div className="nav-label" style={{ padding: '20px 4px 10px' }}>
        Queue
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

      <div className="nav-label" style={{ padding: '20px 4px 10px' }}>
        Car mode
      </div>
      <div className="set-group">
        <SetRow
          title="Car mode"
          desc={carDesc}
          control={
            <Seg<CarMode>
              value={s.carMode}
              onChange={(v) => set('carMode', v)}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
            />
          }
        />
        <SetRow
          title="Fade controls when idle"
          desc="Dim the background and hide secondary controls after a few seconds idle."
          control={<Toggle on={s.carFadeEnabled} onChange={(v) => set('carFadeEnabled', v)} />}
        />
        {s.carFadeEnabled && (
          <SetRow
            title="Fade delay"
            desc="How long to wait, with no taps, before fading."
            control={null}
            stacked
          >
            <Slider
              value={s.carFadeSec}
              min={10}
              max={120}
              step={5}
              onChange={(v) => set('carFadeSec', v)}
              formatLabel={(v) => `${v}s`}
            />
          </SetRow>
        )}
      </div>

      <div className="nav-label" style={{ padding: '20px 4px 10px' }}>
        Sleep timer
      </div>
      <div className="set-group">
        <SetRow
          title="Rewind on wake"
          desc="Jump back this far when the sleep timer pauses, so you don't lose your place."
          control={null}
          stacked
        >
          <Slider
            value={s.sleepRewindSec}
            min={0}
            max={120}
            step={5}
            onChange={(v) => set('sleepRewindSec', v)}
            formatLabel={(v) => (v === 0 ? 'Off' : `${v}s`)}
          />
        </SetRow>
        <SetRow
          title="Stay within the chapter"
          desc="When rewinding on stop, don't cross back into the previous chapter."
          control={<Toggle on={s.chapterBarrier} onChange={(v) => set('chapterBarrier', v)} />}
        />
        <SetRow
          title="Fade out"
          desc="Gradually lower the volume before the sleep timer pauses."
          control={<Toggle on={s.sleepFade} onChange={(v) => set('sleepFade', v)} />}
        />
        {s.sleepFade && (
          <SetRow title="Fade length" desc="How long the fade-out takes." control={null} stacked>
            <Slider
              value={s.sleepFadeLen}
              min={5}
              max={60}
              step={5}
              onChange={(v) => set('sleepFadeLen', v)}
              formatLabel={(v) => `${v}s`}
            />
          </SetRow>
        )}
        <SetRow
          title="Auto sleep timer"
          desc="Start a timer automatically when you press play during quiet hours."
          control={<Toggle on={s.autoSleep} onChange={(v) => set('autoSleep', v)} />}
        />
        {s.autoSleep && (
          <>
            <SetRow
              title="Quiet hours"
              desc="When auto sleep should kick in."
              control={
                <div className="time-row">
                  <input
                    className="fld"
                    type="time"
                    value={s.autoSleepStart}
                    onChange={(e) => set('autoSleepStart', e.target.value)}
                  />
                  <span style={{ color: 'var(--text-muted)' }}>to</span>
                  <input
                    className="fld"
                    type="time"
                    value={s.autoSleepEnd}
                    onChange={(e) => set('autoSleepEnd', e.target.value)}
                  />
                </div>
              }
            />
            <SetRow
              title="Auto duration"
              desc="Timer length auto sleep starts with."
              control={
                <NumberInput
                  value={s.autoSleepDur}
                  min={5}
                  max={180}
                  suffix="m"
                  onChange={(v) => set('autoSleepDur', v)}
                />
              }
            />
          </>
        )}
      </div>

      <div className="nav-label" style={{ padding: '20px 4px 10px' }}>
        Book Club
      </div>
      <div className="set-group">
        <SetRow
          title="Note pops"
          desc="Show a toast when playback crosses a note in a club you're in."
          control={<Toggle on={s.notePops} onChange={(v) => set('notePops', v)} />}
        />
      </div>
    </section>
  )
}
