import { useSettingsStore } from '@/store/settingsStore'
import { Icon } from '@/components/common/Icon'
import { SetRow, Toggle, Slider, NumberInput } from '@/components/settings/controls'

export function SleepTimerSettings() {
  const s = useSettingsStore()
  const set = s.set

  return (
    <section>
      <div className="section-head">
        <Icon name="bedtime" />
        <h2>Sleep timer</h2>
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
      </div>

      <div className="section-head" style={{ marginTop: 'var(--s6)' }}>
        <Icon name="schedule" />
        <h2>Auto sleep</h2>
      </div>
      <div className="set-group">
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
    </section>
  )
}
