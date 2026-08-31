import { useSettingsStore, type CarMode, type CarScale } from '@/store/settingsStore'
import { Icon } from '@/components/common/Icon'
import { SetRow, Seg, Toggle, Slider } from '@/components/settings/controls'
import { isCarBrowser } from '@/hooks/useCarMode'
import { useCarScale } from '@/hooks/useCarScale'

export function CarModeSettings() {
  const s = useSettingsStore()
  const set = s.set
  const carDetected = isCarBrowser()
  const effectiveScale = useCarScale()
  const scaleDesc =
    s.carScale === 'auto'
      ? effectiveScale === 1
        ? 'Matching this screen automatically. It looks standard, so nothing is being shrunk.'
        : `Matching this screen automatically - currently ${Math.round(effectiveScale * 100)}%.`
      : 'Shrinks the car player and its controls. Use this if everything looks too big or too small.'
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
          title="Car display size"
          desc={scaleDesc}
          control={
            <Seg<CarScale>
              value={s.carScale}
              onChange={(v) => set('carScale', v)}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 100, label: '100%' },
                { value: 85, label: '85%' },
                { value: 75, label: '75%' },
                { value: 65, label: '65%' },
                { value: 50, label: '50%' },
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
