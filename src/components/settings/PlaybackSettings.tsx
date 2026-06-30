import { useSettingsStore, type ScrubberScope, type CarMode } from '@/store/settingsStore'
import { Icon } from '@/components/common/Icon'
import { SetRow, Seg, Toggle } from '@/components/settings/controls'
import { isCarBrowser } from '@/hooks/useCarMode'

export function PlaybackSettings() {
  const s = useSettingsStore()
  const set = s.set
  const carDetected = isCarBrowser()
  // What 'Auto' resolves to right now, surfaced so the choice isn't a mystery.
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
          <Seg<number>
            value={s.skipForward}
            onChange={(v) => set('skipForward', v)}
            options={[
              { value: 15, label: '15s' },
              { value: 30, label: '30s' },
              { value: 60, label: '60s' },
            ]}
          />
        }
      />

      <SetRow
        title="Skip back"
        desc="How far the back button jumps."
        control={
          <Seg<number>
            value={s.skipBack}
            onChange={(v) => set('skipBack', v)}
            options={[
              { value: 10, label: '10s' },
              { value: 15, label: '15s' },
              { value: 30, label: '30s' },
            ]}
          />
        }
      />

      <SetRow
        title="Hearth background"
        desc="Show the cozy hearth artwork behind the full-screen player."
        control={<Toggle on={s.hearthBgPlayer} onChange={(v) => set('hearthBgPlayer', v)} />}
      />

      <div className="nav-label" style={{ padding: '16px 4px 10px' }}>
        Car mode
      </div>

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

      <div className="nav-label" style={{ padding: '16px 4px 10px' }}>
        Sleep timer
      </div>

      <SetRow
        title="Rewind on stop"
        desc="Jump back this far when the sleep timer pauses, so you don't lose your place."
        control={
          <Seg<number>
            value={s.sleepRewindSec}
            onChange={(v) => set('sleepRewindSec', v)}
            options={[
              { value: 0, label: 'Off' },
              { value: 15, label: '15s' },
              { value: 30, label: '30s' },
              { value: 60, label: '60s' },
            ]}
          />
        }
      />

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
          control={
            <Seg<number>
              value={s.sleepFadeLen}
              onChange={(v) => set('sleepFadeLen', v)}
              options={[
                { value: 10, label: '10s' },
                { value: 20, label: '20s' },
                { value: 30, label: '30s' },
              ]}
            />
          }
        />
      )}
    </section>
  )
}
