import { Icon } from '@/components/common/Icon'
import { SetRow, Slider, Toggle } from '@/components/settings/controls'
import { useSettingsStore } from '@/store/settingsStore'

export function NotificationSettings() {
  const s = useSettingsStore()
  const set = s.set

  const setMaster = (on: boolean) => {
    set('notifyEnabled', on)
    if (on && !s.notifyInApp && !s.notifyEmail) set('notifyInApp', true)
  }

  const setDestination = (key: 'notifyInApp' | 'notifyEmail', on: boolean) => {
    set(key, on)
    const otherOn = key === 'notifyInApp' ? s.notifyEmail : s.notifyInApp
    if (!on && !otherOn) set('notifyEnabled', false)
  }

  return (
    <section>
      <div className="section-head">
        <Icon name="notifications" />
        <h2>Notifications</h2>
      </div>
      <p className="t-muted mb-4 text-[13px]">
        Choose where HearthShelf tells you about books and series you follow.
      </p>

      <div className="cn-label">Release alerts</div>
      <div className="set-group">
        <SetRow
          title="Release notifications"
          desc="Get told when a book you're waiting for is ready."
          control={<Toggle on={s.notifyEnabled} onChange={setMaster} />}
        />
      </div>

      {s.notifyEnabled && (
        <>
          <div className="cn-label">Delivery</div>
          <div className="set-group">
            <SetRow
              title="In app"
              desc="Show alerts in the HearthShelf notification tray. Mobile also sends a phone alert."
              control={
                <Toggle on={s.notifyInApp} onChange={(on) => setDestination('notifyInApp', on)} />
              }
            />
            <SetRow
              title="Email"
              desc="Send alerts to the email on your server account."
              control={
                <Toggle on={s.notifyEmail} onChange={(on) => setDestination('notifyEmail', on)} />
              }
            />
          </div>

          <div className="cn-label">Alert me</div>
          <div className="set-group">
            <SetRow
              title="When it's in your library"
              desc="The moment a followed book is ready to play."
              control={
                <Toggle
                  on={s.notifyAvailableInLibrary}
                  onChange={(on) => set('notifyAvailableInLibrary', on)}
                />
              }
            />
            <SetRow
              title="On release day"
              desc="When the catalog says it's out, even before it syncs in."
              control={
                <Toggle
                  on={s.notifyOnReleaseDate}
                  onChange={(on) => set('notifyOnReleaseDate', on)}
                />
              }
            />
            <SetRow
              title="Early reminder"
              desc={
                s.notifyReminderDaysBefore > 0
                  ? `${s.notifyReminderDaysBefore} day${s.notifyReminderDaysBefore === 1 ? '' : 's'} before release.`
                  : 'No early reminder.'
              }
              control={null}
              stacked
            >
              <Slider
                value={s.notifyReminderDaysBefore}
                min={0}
                max={14}
                onChange={(value) => set('notifyReminderDaysBefore', value)}
                formatLabel={(value) => (value === 0 ? 'Off' : `${value}d`)}
              />
            </SetRow>
          </div>
        </>
      )}

      <div className="cn-label">Home</div>
      <div className="set-group">
        <SetRow
          title="Countdown on Home"
          desc={`Show a countdown starting ${s.notifyCountdownWindowDays} day${s.notifyCountdownWindowDays === 1 ? '' : 's'} before release.`}
          control={null}
          stacked
        >
          <Slider
            value={s.notifyCountdownWindowDays}
            min={1}
            max={30}
            onChange={(value) => set('notifyCountdownWindowDays', value)}
            formatLabel={(value) => `${value}d`}
          />
        </SetRow>
      </div>

      <p className="t-muted mt-3 text-[12px]">
        Book club invitations always arrive in-app and by email so they can be accepted.
      </p>
    </section>
  )
}
