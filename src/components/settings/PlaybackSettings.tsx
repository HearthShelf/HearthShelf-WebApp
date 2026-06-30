import { useSettingsStore, type ScrubberScope, type CarMode } from '@/store/settingsStore'
import { Icon } from '@/components/common/Icon'
import { SetRow, Seg, Toggle, Slider, NumberInput } from '@/components/settings/controls'
import { isCarBrowser } from '@/hooks/useCarMode'

const SKIP_FWD_PRESETS = [15, 30, 60]
const SKIP_BACK_PRESETS = [10, 15, 30]

export function PlaybackSettings() {
  const s = useSettingsStore()
  const set = s.set
  const carDetected = isCarBrowser()

  const carDesc =
    s.carMode === 'auto'
      ? carDetected
        ? 'A car browser was detected, so the big-touch player is on.'
        : "Turns on the big-touch player automatically when a car browser (like Tesla) is detected. None detected here."
      : s.carMode === 'on'
        ? 'The big-touch player is always on.'
        : 'The big-touch player is off.'

  return (
    <section>
      <div className="section-head">
        <Icon name="graphic_eq" />
        <h2>Playback</h2>
      </div>

      <div className="set-group">
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
                  if (v !== 0) set('skipForward', v)
                }}
                options={[
                  ...SKIP_FWD_PRESETS.map((n) => ({ value: n, label: `${n}s` })),
                  { value: 0, label: 'Custom' },
                ]}
              />
              {!SKIP_FWD_PRESETS.includes(s.skipForward) && (
                <NumberInput
                  value={s.skipForwardCustom}
                  min={1}
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
                  if (v !== 0) set('skipBack', v)
                }}
                options={[
                  ...SKIP_BACK_PRESETS.map((n) => ({ value: n, label: `${n}s` })),
                  { value: 0, label: 'Custom' },
                ]}
              />
              {!SKIP_BACK_PRESETS.includes(s.skipBack) && (
                <NumberInput
                  value={s.skipBackCustom}
                  min={1}
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
        Car mode
      </div>

      <div className="set-group">
        <SetRow
          title="Big-touch player"
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
          desc="Dim the background and hide secondary controls after a few seconds idle - the cover, title, scrubber, and main transport always stay visible."
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
          <SetRow
            title="Fade length"
            desc="How long the fade-out takes."
            control={null}
            stacked
          >
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
      </div>
    </section>
  )
}
