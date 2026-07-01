import {
  useSettingsStore,
  ACCENT_PRESETS,
  type Theme,
  type CoverStyle,
} from '@/store/settingsStore'
import { Icon } from '@/components/common/Icon'
import { SetRow, Seg, Toggle } from '@/components/settings/controls'

// Appearance: theme, accent colour, and cover style. Theme is applied to the
// document root via data-theme (see useApplySettings); accent sets the --accent
// / --primary CSS vars live.
export function AppearanceSettings() {
  const s = useSettingsStore()
  const set = s.set

  return (
    <section>
      <div className="section-head">
        <Icon name="palette" />
        <h2>Appearance</h2>
      </div>
      <p className="t-muted mb-4 text-[13px]">
        Make HearthShelf yours. Dark is home; light is a daytime option.
      </p>

      <div className="set-group">
        <SetRow
          title="Theme"
          desc="Dark is home; OLED goes pure black; light for daytime reading."
          control={
            <Seg<Theme>
              value={s.theme}
              onChange={(v) => set('theme', v)}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'oled', label: 'OLED' },
                { value: 'light', label: 'Light' },
              ]}
            />
          }
        />

        <SetRow
          title="Accent colour"
          desc="The colour for buttons, progress, and active controls."
          control={
            <div className="swatch-row">
              {ACCENT_PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.name}
                  title={p.name}
                  aria-label={p.name}
                  className={'swatch' + (s.accentHex === p.hex ? ' on' : '')}
                  style={{ background: p.hex }}
                  onClick={() => {
                    set('accentMode', 'manual')
                    set('accentHex', p.hex)
                  }}
                />
              ))}
            </div>
          }
        />

        <SetRow
          title="Cover style"
          desc="Float artwork on the page, or sit it on cards."
          control={
            <Seg<CoverStyle>
              value={s.coverStyle}
              onChange={(v) => set('coverStyle', v)}
              options={[
                { value: 'floating', label: 'Floating' },
                { value: 'cards', label: 'Cards' },
              ]}
            />
          }
        />

        <SetRow
          title="Card background"
          desc="Show a subtle surface behind book cards and shelf items."
          control={<Toggle on={s.cardBg} onChange={(v) => set('cardBg', v)} />}
        />

        <SetRow
          title="Use shared settings"
          desc="Keep this device's settings in step with your other devices. Turn off to keep this device's look and feel on its own."
          control={
            <Toggle on={s.useSharedSettings} onChange={(v) => set('useSharedSettings', v)} />
          }
        />
      </div>
    </section>
  )
}
