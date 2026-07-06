import { useSettingsStore } from '@/store/settingsStore'
import { Icon } from '@/components/common/Icon'
import { SetRow, Toggle } from '@/components/settings/controls'

export function BookClubSettings() {
  const s = useSettingsStore()
  const set = s.set

  return (
    <section>
      <div className="section-head">
        <Icon name="groups" />
        <h2>Book Club</h2>
      </div>
      <div className="set-group">
        <SetRow
          title="Note pops"
          desc="Show a toast when playback crosses a note in a club you're in."
          control={<Toggle on={s.notePops} onChange={(v) => set('notePops', v)} />}
        />
      </div>
    </section>
  )
}
