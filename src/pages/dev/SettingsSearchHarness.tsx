import { useLocation } from 'react-router-dom'
import { Icon } from '@/components/common/Icon'
import { SetRow, Toggle } from '@/components/settings/controls'
import { SettingsSearch } from '@/components/settings/SettingsSearch'

// DEV-ONLY visual harness for the settings search box. The real AccountPage is
// behind Clerk, which refuses to load on localhost, so this renders the search
// field inside the same .settings-shell markup with a couple of real SetRows to
// show the arrival flash. Gated to import.meta.env.DEV in the router.
export function SettingsSearchHarness() {
  // Echo the navigation state so the highlight hand-off is visible even when the
  // picked section has no row rendered here.
  const state = useLocation().state as { highlight?: string } | null

  return (
    <div className="app">
      <div className="page fade-in settings-shell" style={{ padding: 24 }}>
        <div className="page-head-row settings-head">
          <div>
            <div className="eyebrow">Make it yours</div>
            <h1 className="title-xl">Settings</h1>
          </div>
          {/* Results route back into this harness so picking one doesn't leave
              for the Clerk-gated /account tree. */}
          <SettingsSearch basePath="/dev/settings-search" />
        </div>

        <div className="config-wrap">
          <div className="config-body">
            <section>
              <div className="section-head">
                <Icon name="graphic_eq" />
                <h2>Playback</h2>
              </div>
              <p className="t-muted mb-4 text-[13px]">
                Last picked: <code>{state?.highlight ?? '(nothing yet)'}</code>
              </p>
              <div className="set-group">
                <SetRow
                  title="Skip forward"
                  desc="How far the forward button jumps."
                  control={<Toggle on onChange={() => undefined} />}
                />
                <SetRow
                  title="Hide mini player"
                  desc="Turn off the docked bar that shows what's playing."
                  control={<Toggle on={false} onChange={() => undefined} />}
                />
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
