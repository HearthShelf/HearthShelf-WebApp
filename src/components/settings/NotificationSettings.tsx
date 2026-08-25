import type { NotifyChannel, NotifyType } from '@hearthshelf/core'
import { resolveChannels } from '@hearthshelf/core'
import { Icon } from '@/components/common/Icon'
import { ChannelChips, SetRow, Slider, Toggle } from '@/components/settings/controls'
import { useSettingsStore } from '@/store/settingsStore'

/** The three delivery channels, in the order they appear under Delivery. */
const CHANNEL_OPTIONS: { id: NotifyChannel; label: string }[] = [
  { id: 'inApp', label: 'In app' },
  { id: 'push', label: 'Push' },
  { id: 'email', label: 'Email' },
]

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

  // Per-type channel choice. The stored shape is an OVERRIDE of `global`, and a
  // type with no override inherits it - so the first edit has to materialize the
  // currently-resolved set, otherwise flipping one channel off would silently
  // re-pin the other two to today's global values.
  const setTypeChannel = (type: NotifyType, channel: NotifyChannel, on: boolean) => {
    const channels = { ...resolveChannels(prefs, type), [channel]: on }
    s.set('notifyPrefs', {
      ...prefs,
      types: { ...prefs.types, [type]: { ...prefs.types[type], channels } },
    })
  }

  // A channel switched off globally can't be turned on for one type - the
  // Delivery rows above are the master. Say so on the chip instead of hiding it,
  // so "why is this not arriving" stays answerable from this screen.
  const lockedChannels = (type: NotifyType): Partial<Record<NotifyChannel, string>> => {
    const locks: Partial<Record<NotifyChannel, string>> = {}
    if (!prefs.global.inApp) locks.inApp = 'Turn on In app under Delivery first.'
    if (!prefs.global.push) locks.push = 'Turn on Mobile push under Delivery first.'
    if (!prefs.global.email) locks.email = 'Turn on Email under Delivery first.'
    // An invite you cannot see is an invite you cannot accept, which strands
    // both you and whoever sent it. The server floors this on regardless, so the
    // chip must not offer a choice it will not honour.
    if (type === 'clubInvite') locks.inApp = 'Invites always show in the app.'
    return locks
  }

  /** One notification type: its on/off switch plus which channels it uses. */
  const typeRow = (type: NotifyType, title: string, desc: string) => {
    const enabled = prefs.types[type].enabled
    const channels = { ...resolveChannels(prefs, type) }
    // Mirror the server's floor so the chip shows what will actually happen.
    if (type === 'clubInvite') channels.inApp = true
    return (
      <div className="set-row set-row-both">
        <div className="sr-meta">
          <div className="sr-t">{title}</div>
          <div className="sr-d">{desc}</div>
        </div>
        <Toggle on={enabled} onChange={(on) => setTypeEnabled(type, on)} />
        {enabled && (
          <div className="sr-extra">
            <ChannelChips
              options={CHANNEL_OPTIONS}
              selected={channels}
              disabled={lockedChannels(type)}
              onToggle={(channel, next) => setTypeChannel(type, channel, next)}
            />
          </div>
        )}
      </div>
    )
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
        {typeRow('release', 'Release alerts', 'Books and series you follow.')}
        {typeRow(
          'clubInvite',
          'Book club invites',
          'When someone invites you to join their book club.',
        )}
        {typeRow(
          'mention',
          'Club mentions',
          'When someone @mentions you in a book club discussion.',
        )}
        {typeRow('reply', 'Comment replies', 'When someone replies to one of your club comments.')}
        {typeRow(
          'lateNote',
          'Comments on parts you’ve heard',
          'When someone comments on a spot you already listened past.',
        )}
        {typeRow(
          'reaction',
          'Comment reactions',
          'When someone reacts to one of your club comments.',
        )}
        {typeRow('rating', 'Rate a finished book', 'Ask how it was when you finish a book.')}
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
