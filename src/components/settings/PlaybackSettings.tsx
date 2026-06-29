import { useSettingsStore, type ScrubberScope } from '@/store/settingsStore'
import { Icon } from '@/components/common/Icon'
import { SetRow, Seg, Toggle } from '@/components/settings/controls'

export function PlaybackSettings() {
  const s = useSettingsStore()
  const set = s.set

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
