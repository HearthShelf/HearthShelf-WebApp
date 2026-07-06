import { useSettingsStore, type CarMode } from '@/store/settingsStore'
import { Icon } from '@/components/common/Icon'
import { SetRow, Seg, Toggle, Slider } from '@/components/settings/controls'
import { isCarBrowser } from '@/hooks/useCarMode'

export function CarModeSettings() {
  const s = useSettingsStore()
  const set = s.set
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
        <Icon name="directions_car" />
        <h2>Car mode</h2>
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
    </section>
  )
}
