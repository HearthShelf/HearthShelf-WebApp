import type { NotifyChannel, NotifyType } from '@hearthshelf/core'
import { Icon } from '@/components/common/Icon'
import { SetRow, Slider, Toggle } from '@/components/settings/controls'
import { useSettingsStore } from '@/store/settingsStore'

/**
 * Delivery is global; each category sits under it.
 *
 * The previous layout hung everything off a "Release notifications" master, so
 * there was nowhere to say how you want to hear about anything else - and
 * "In app" secretly meant both the tray and a phone alert. Channels are now
 * chosen once and categories opt in or out individually.
 */
export function NotificationSettings() {
  const s = useSettingsStore()
  const prefs = s.notifyPrefs

  const setGlobal = (channel: NotifyChannel, on: boolean) => {
    const global = { ...prefs.global, [channel]: on }
    // Every channel off means "notify me nowhere", which reads as a bug rather
    // than a choice - keep the tray on as the floor.
    if (!global.inApp && !global.push && !global.email) global.inApp = true
    s.set('notifyPrefs', { ...prefs, global })
  }

  const setTypeEnabled = (type: NotifyType, on: boolean) => {
    s.set('notifyPrefs', {
      ...prefs,
      types: { ...prefs.types, [type]: { ...prefs.types[type], enabled: on } },
    })
  }

  const setRelease = (patch: Partial<typeof prefs.types.release>) => {
    s.set('notifyPrefs', {
      ...prefs,
      types: { ...prefs.types, release: { ...prefs.types.release, ...patch } },
    })
  }

  const release = prefs.types.release

  return (
    <section>
      <div className="section-head">
        <Icon name="notifications" />
        <h2>Notifications</h2>
      </div>
      <p className="t-muted mb-4 text-[13px]">
        Pick where HearthShelf reaches you, then choose what's worth reaching you about.
      </p>

      <div className="cn-label">Delivery</div>
      <div className="set-group">
        <SetRow
          title="In app"
          desc="Show alerts in the HearthShelf notification tray."
          control={<Toggle on={prefs.global.inApp} onChange={(on) => setGlobal('inApp', on)} />}
        />
        <SetRow
          title="Mobile push"
          desc="Send an alert to the HearthShelf app on your phone."
          control={<Toggle on={prefs.global.push} onChange={(on) => setGlobal('push', on)} />}
        />
        <SetRow
          title="Email"
          desc="Send alerts to the email on your server account."
          control={<Toggle on={prefs.global.email} onChange={(on) => setGlobal('email', on)} />}
        />
      </div>

      <div className="cn-label">Alert me about</div>
      <div className="set-group">
        <SetRow
          title="Release alerts"
          desc="Books and series you follow."
          control={
            <Toggle on={release.enabled} onChange={(on) => setTypeEnabled('release', on)} />
          }
        />
        <SetRow
          title="Club mentions"
          desc="When someone @mentions you in a book club discussion."
          control={
            <Toggle
              on={prefs.types.mention.enabled}
              onChange={(on) => setTypeEnabled('mention', on)}
            />
          }
        />
      </div>

      {release.enabled && (
        <>
          <div className="cn-label">Release alerts</div>
          <div className="set-group">
            <SetRow
              title="When it's in your library"
              desc="The moment a followed book is ready to play."
              control={
                <Toggle
                  on={release.availableInLibrary}
                  onChange={(on) => setRelease({ availableInLibrary: on })}
                />
              }
            />
            <SetRow
              title="On release day"
              desc="When the catalog says it's out, even before it syncs in."
              control={
                <Toggle
                  on={release.onReleaseDate}
                  onChange={(on) => setRelease({ onReleaseDate: on })}
                />
              }
            />
            <SetRow
              title="Early reminder"
              desc={
                release.reminderDaysBefore > 0
                  ? `${release.reminderDaysBefore} day${release.reminderDaysBefore === 1 ? '' : 's'} before release.`
                  : 'No early reminder.'
              }
              control={null}
              stacked
            >
              <Slider
                value={release.reminderDaysBefore}
                min={0}
                max={30}
                onChange={(value) => setRelease({ reminderDaysBefore: value })}
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
          desc={`Show a countdown starting ${prefs.countdownWindowDays} day${prefs.countdownWindowDays === 1 ? '' : 's'} before release.`}
          control={null}
          stacked
        >
          <Slider
            value={prefs.countdownWindowDays}
            min={1}
            max={30}
            onChange={(value) => s.set('notifyPrefs', { ...prefs, countdownWindowDays: value })}
            formatLabel={(value) => `${value}d`}
          />
        </SetRow>
      </div>

      <p className="t-muted mt-3 text-[12px]">
        Book club invitations always arrive in the tray so you can accept them, whatever else is
        switched off here.
      </p>
    </section>
  )
}
