import { useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { SetRow, Seg, Toggle, Slider, NumberInput } from '@/components/settings/controls'

// DEV-ONLY visual harness for the settings page under car mode. Renders the
// real settings primitives (SetRow / Seg / Toggle / Slider / NumberInput) and
// the section sub-nav inside the exact .app.car-mode .settings-shell markup, so
// the large-touch CSS overrides can be eyeballed without Clerk or a live
// server (the real AccountPage needs auth). Gated to import.meta.env.DEV in the
// router - never reachable in a production build.
const NAV = [
  {
    label: 'You',
    items: [
      { id: 'account', icon: 'person', label: 'Account' },
      { id: 'appearance', icon: 'palette', label: 'Appearance' },
    ],
  },
  { label: 'Listening', items: [{ id: 'playback', icon: 'graphic_eq', label: 'Playback' }] },
  { label: 'Reading', items: [{ id: 'reading', icon: 'menu_book', label: 'Reading' }] },
  {
    label: 'HearthShelf',
    items: [
      { id: 'servers', icon: 'dns', label: 'My servers' },
      { id: 'plan', icon: 'workspace_premium', label: 'Subscription' },
    ],
  },
]

export function SettingsCarHarness() {
  const [section, setSection] = useState('playback')
  const [carMode, setCarMode] = useState<'auto' | 'on' | 'off'>('on')
  const [fade, setFade] = useState(true)
  const [fadeSec, setFadeSec] = useState(30)
  const [skip, setSkip] = useState(30)

  return (
    <div className="app car-mode">
      <div className="page fade-in settings-shell" style={{ padding: 24 }}>
        <div className="page-head">
          <div className="eyebrow">Make it yours</div>
          <h1 className="title-xl">Settings</h1>
        </div>

        <div className="config-wrap">
          <nav className="config-nav">
            {NAV.map((group) => (
              <div key={group.label}>
                <div className="cn-label">{group.label}</div>
                {group.items.map((n) => (
                  <button
                    key={n.id}
                    className={'cn-item' + (section === n.id ? ' on' : '')}
                    onClick={() => setSection(n.id)}
                  >
                    <Icon name={n.icon} fill={section === n.id} />
                    {n.label}
                    <Icon name="chevron_right" className="cn-chev" />
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="config-body">
            <section>
              <div className="section-head">
                <Icon name="graphic_eq" />
                <h2>Playback</h2>
              </div>

              <div className="nav-label" style={{ padding: '20px 4px 10px' }}>
                Skip
              </div>
              <div className="set-group">
                <SetRow
                  title="Skip forward"
                  desc="How many seconds the forward button jumps."
                  control={
                    <NumberInput value={skip} min={5} max={120} suffix="s" onChange={setSkip} />
                  }
                />
              </div>

              <div className="nav-label" style={{ padding: '20px 4px 10px' }}>
                Car mode
              </div>
              <div className="set-group">
                <SetRow
                  title="Car mode"
                  desc="Turns on automatically when a car browser is detected."
                  control={
                    <Seg<'auto' | 'on' | 'off'>
                      value={carMode}
                      onChange={setCarMode}
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
                  control={<Toggle on={fade} onChange={setFade} />}
                />
                {fade && (
                  <SetRow
                    title="Fade delay"
                    desc="How long to wait, with no taps, before fading."
                    control={null}
                    stacked
                  >
                    <Slider
                      value={fadeSec}
                      min={10}
                      max={120}
                      step={5}
                      onChange={setFadeSec}
                      formatLabel={(v) => `${v}s`}
                    />
                  </SetRow>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
