import { useSettingsStore, type ScrubberScope } from '@/store/settingsStore'
import { Icon } from '@/components/common/Icon'
import { SetRow, Seg, Toggle, NumberInput } from '@/components/settings/controls'

const SKIP_FWD_PRESETS = [15, 30, 60]
const SKIP_BACK_PRESETS = [10, 15, 30]
const SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 2]

export function PlaybackSettings() {
  const s = useSettingsStore()
  const set = s.set

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
          title="Hide mini player"
          desc="Turn off the docked bar that shows what's playing. Open the full player from the nav or a book's Play button."
          control={<Toggle on={s.hideMiniPlayer} onChange={(v) => set('hideMiniPlayer', v)} />}
        />
      </div>

      <div className="section-head" style={{ marginTop: 'var(--s6)' }}>
        <Icon name="fullscreen" />
        <h2>Full-screen player</h2>
      </div>
      <div className="set-group">
        <SetRow
          title="Tap artwork to play"
          desc="Tap the cover on the full-screen player to play or pause."
          control={
            <Toggle
              on={s.tapArtworkTogglesPlay}
              onChange={(v) => set('tapArtworkTogglesPlay', v)}
            />
          }
        />
        <SetRow
          title="Skip hotspots"
          desc="Double-tap the sides of the artwork to jump back or forward."
          control={<Toggle on={s.skipHotspots} onChange={(v) => set('skipHotspots', v)} />}
        />
        <SetRow
          title="Hearth background"
          desc="Show the cozy hearth artwork behind the full-screen player."
          control={<Toggle on={s.hearthBgPlayer} onChange={(v) => set('hearthBgPlayer', v)} />}
        />
      </div>
    </section>
  )
}
