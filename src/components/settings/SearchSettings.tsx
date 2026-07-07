import { Icon } from '@/components/common/Icon'
import { Toggle } from '@/components/settings/controls'
import { useSettingsStore } from '@/store/settingsStore'

export function SearchSettings() {
  const searchExternalSources = useSettingsStore((s) => s.searchExternalSources)
  const setSetting = useSettingsStore((s) => s.set)
  return (
    <section>
      <div className="section-head">
        <Icon name="search" />
        <h2>Search</h2>
      </div>
      <div className="cfg-card">
        <div className="cfg-line">
          <Icon name="travel_explore" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Search outside your library</div>
            <div className="cl-d">
              Also find audiobooks you don't own yet. Search shows them in a "Not in your library"
              section so you can request them.
            </div>
          </div>
          <Toggle
            on={searchExternalSources}
            onChange={(v) => setSetting('searchExternalSources', v)}
          />
        </div>
      </div>
    </section>
  )
}
