// Flat index of every user setting, so the Settings search box can jump straight
// to a control instead of making people guess which section holds it.
//
// Keep this in step with the panels under components/settings: a row that isn't
// listed here is unreachable by search. `keywords` carries the words people
// actually type that don't appear in the title or description (old names, the
// other platform's wording, related concepts).

export type SettingEntry = {
  /** Section id in AccountPage's NAV - the route segment under /account. */
  section: string
  /** Section label, shown as the result's breadcrumb. */
  sectionLabel: string
  /** Material symbol for the result row, matching the section's nav icon. */
  icon: string
  /** The row's visible title. */
  title: string
  /** The row's description, when it has one. */
  desc?: string
  /** Extra search terms that don't appear in title/desc. */
  keywords?: string
}

export const SETTINGS_INDEX: SettingEntry[] = [
  // ---- Account
  {
    section: 'account',
    sectionLabel: 'Account',
    icon: 'person',
    title: 'Profile photo',
    desc: 'The picture that represents you.',
    keywords: 'avatar picture image upload',
  },
  {
    section: 'account',
    sectionLabel: 'Account',
    icon: 'person',
    title: 'Sync photo to your servers',
    desc: 'Push your profile photo out to the servers you have linked.',
    keywords: 'avatar picture upload',
  },
  {
    section: 'account',
    sectionLabel: 'Account',
    icon: 'person',
    title: 'Use Gravatar',
    desc: 'Use the photo tied to your email address.',
    keywords: 'avatar picture email',
  },
  {
    section: 'account',
    sectionLabel: 'Account',
    icon: 'person',
    title: 'Use shared settings',
    desc: 'Share one set of settings across your devices, or keep this device separate.',
    keywords: 'device sync per-device local',
  },
  {
    section: 'account',
    sectionLabel: 'Account',
    icon: 'person',
    title: 'Permissions',
    desc: 'What this account is allowed to do on the server.',
    keywords: 'access rights role',
  },
  {
    section: 'account',
    sectionLabel: 'Account',
    icon: 'person',
    title: 'Advanced',
    desc: 'Build, photo sync status, car browser detection, and user agent.',
    keywords: 'debug diagnostics version build user agent',
  },

  // ---- Appearance
  {
    section: 'appearance',
    sectionLabel: 'Appearance',
    icon: 'palette',
    title: 'Theme',
    desc: 'Dark is home; OLED goes pure black; light for daytime reading.',
    keywords: 'dark light oled black colour color mode night',
  },
  {
    section: 'appearance',
    sectionLabel: 'Appearance',
    icon: 'palette',
    title: 'Accent colour',
    desc: 'The colour for buttons, progress, and active controls.',
    keywords: 'color accent highlight swatch',
  },
  {
    section: 'appearance',
    sectionLabel: 'Appearance',
    icon: 'palette',
    title: 'Cover-glow intensity',
    desc: 'How strongly cover colours bloom behind artwork.',
    keywords: 'glow bloom artwork colour color',
  },
  {
    section: 'appearance',
    sectionLabel: 'Appearance',
    icon: 'palette',
    title: 'Cover glow style',
    desc: 'Gradient blooms live; Image is the lighter-weight option.',
    keywords: 'glow gradient image performance',
  },
  {
    section: 'appearance',
    sectionLabel: 'Appearance',
    icon: 'palette',
    title: 'Cover style',
    desc: 'Float artwork on the page, or sit it on cards.',
    keywords: 'floating cards artwork',
  },
  {
    section: 'appearance',
    sectionLabel: 'Appearance',
    icon: 'palette',
    title: 'Card background',
    desc: 'Show a subtle surface behind book cards and shelf items.',
    keywords: 'cards surface shelf',
  },

  // ---- Notifications
  // `title` must match the SetRow title exactly - it is the highlight key that
  // scrolls to and flashes the row (see useSettingHighlight).
  {
    section: 'notifications',
    sectionLabel: 'Notifications',
    icon: 'notifications',
    title: 'In app',
    desc: 'Show alerts in the HearthShelf notification tray.',
    keywords: 'inbox bell tray delivery channel',
  },
  {
    section: 'notifications',
    sectionLabel: 'Notifications',
    icon: 'notifications',
    title: 'Mobile push',
    desc: 'Send an alert to the HearthShelf app on your phone.',
    keywords: 'push phone mobile device delivery channel alert',
  },
  {
    section: 'notifications',
    sectionLabel: 'Notifications',
    icon: 'notifications',
    title: 'Email',
    desc: 'Send alerts to the email on your server account.',
    keywords: 'mail delivery channel',
  },
  {
    section: 'notifications',
    sectionLabel: 'Notifications',
    icon: 'notifications',
    title: 'Release alerts',
    desc: 'Books and series you follow.',
    keywords: 'upcoming followed books series alerts releases',
  },
  {
    section: 'notifications',
    sectionLabel: 'Notifications',
    icon: 'notifications',
    title: 'Club mentions',
    desc: 'When someone @mentions you in a book club discussion.',
    keywords: 'mention mentions at club book discussion comment reply tagged',
  },
  {
    section: 'notifications',
    sectionLabel: 'Notifications',
    icon: 'notifications',
    title: 'Rate a finished book',
    desc: 'Ask how it was when you finish a book. Shows in your tray only.',
    keywords: 'rating rate stars review finished completed prompt ask',
  },
  {
    section: 'notifications',
    sectionLabel: 'Notifications',
    icon: 'notifications',
    title: "When it's in your library",
    desc: 'The moment a followed book is ready to play.',
    keywords: 'available synced release alert',
  },
  {
    section: 'notifications',
    sectionLabel: 'Notifications',
    icon: 'notifications',
    title: 'On release day',
    desc: "When the catalog says it's out, even before it syncs in.",
    keywords: 'upcoming audible date alert',
  },
  {
    section: 'notifications',
    sectionLabel: 'Notifications',
    icon: 'notifications',
    title: 'Early reminder',
    desc: 'Choose how many days before release to get a heads-up.',
    keywords: 'upcoming countdown days alert',
  },
  {
    section: 'notifications',
    sectionLabel: 'Notifications',
    icon: 'notifications',
    title: 'Countdown on Home',
    desc: 'Choose when upcoming releases appear on Home.',
    keywords: 'upcoming release days window',
  },

  // ---- Playback
  {
    section: 'playback',
    sectionLabel: 'Playback',
    icon: 'graphic_eq',
    title: 'Default speed',
    desc: 'The rate a fresh book starts at.',
    keywords: 'speed rate tempo faster slower playback',
  },
  {
    section: 'playback',
    sectionLabel: 'Playback',
    icon: 'graphic_eq',
    title: 'Progress bar',
    desc: 'Show the scrubber against the current chapter, or the whole book.',
    keywords: 'scrubber seek bar chapter book',
  },
  {
    section: 'playback',
    sectionLabel: 'Playback',
    icon: 'graphic_eq',
    title: 'Skip forward',
    desc: 'How far the forward button jumps.',
    keywords: 'jump seek forward seconds',
  },
  {
    section: 'playback',
    sectionLabel: 'Playback',
    icon: 'graphic_eq',
    title: 'Skip back',
    desc: 'How far the back button jumps.',
    keywords: 'jump seek rewind back seconds',
  },
  {
    section: 'playback',
    sectionLabel: 'Playback',
    icon: 'graphic_eq',
    title: 'Hide mini player',
    desc: "Turn off the docked bar that shows what's playing.",
    keywords: 'mini player bar dock hide now playing',
  },
  {
    section: 'playback',
    sectionLabel: 'Playback',
    icon: 'graphic_eq',
    title: 'Tap artwork to play',
    desc: 'Tap the cover on the full-screen player to play or pause.',
    keywords: 'full screen player cover tap pause',
  },
  {
    section: 'playback',
    sectionLabel: 'Playback',
    icon: 'graphic_eq',
    title: 'Skip hotspots',
    desc: 'Double-tap the sides of the artwork to jump back or forward.',
    keywords: 'full screen player double tap gesture',
  },
  {
    section: 'playback',
    sectionLabel: 'Playback',
    icon: 'graphic_eq',
    title: 'Hearth background',
    desc: 'Show the cozy hearth artwork behind the full-screen player.',
    keywords: 'full screen player fireplace background artwork',
  },

  // ---- Queue
  {
    section: 'queue',
    sectionLabel: 'Queue',
    icon: 'queue_music',
    title: 'When a book ends',
    desc: 'What plays after the book you are on finishes.',
    keywords: 'autoplay next up continue series',
  },
  {
    section: 'queue',
    sectionLabel: 'Queue',
    icon: 'queue_music',
    title: 'Auto rules',
    desc: 'How the queue picks the next book for you.',
    keywords: 'automatic next series playlist',
  },
  {
    section: 'queue',
    sectionLabel: 'Queue',
    icon: 'queue_music',
    title: 'Your queue',
    desc: 'The books lined up to play next.',
    keywords: 'up next manual queue order reorder',
  },
  {
    section: 'queue',
    sectionLabel: 'Queue',
    icon: 'queue_music',
    title: 'Playlist to follow',
    desc: 'The playlist the queue pulls from.',
    keywords: 'playlist source',
  },
  {
    section: 'queue',
    sectionLabel: 'Queue',
    icon: 'queue_music',
    title: 'Ignored',
    desc: 'Series you ignored and books you set aside. Restore to have them suggested again.',
    keywords: 'ignore ignored hidden dismissed shelves series restore',
  },

  // ---- Car mode
  {
    section: 'carMode',
    sectionLabel: 'Car mode',
    icon: 'directions_car',
    title: 'Car mode',
    desc: 'Big-touch layout for car screens, automatic or always on.',
    keywords: 'car driving android auto carplay big touch',
  },
  {
    section: 'carMode',
    sectionLabel: 'Car mode',
    icon: 'directions_car',
    title: 'Car display size',
    desc: 'Shrink the car player when everything looks too big.',
    keywords: 'scale zoom size big small display resolution tesla shrink text',
  },
  {
    section: 'carMode',
    sectionLabel: 'Car mode',
    icon: 'directions_car',
    title: 'Fade controls when idle',
    desc: 'Dim the background and hide secondary controls after a few seconds idle.',
    keywords: 'dim idle fade car screen',
  },
  {
    section: 'carMode',
    sectionLabel: 'Car mode',
    icon: 'directions_car',
    title: 'Fade delay',
    desc: 'How long to wait, with no taps, before fading.',
    keywords: 'idle timeout dim car',
  },

  // ---- Sleep timer
  {
    section: 'sleepTimer',
    sectionLabel: 'Sleep timer',
    icon: 'bedtime',
    title: 'Rewind on wake',
    desc: "Jump back this far when the sleep timer pauses, so you don't lose your place.",
    keywords: 'sleep rewind back wake bedtime',
  },
  {
    section: 'sleepTimer',
    sectionLabel: 'Sleep timer',
    icon: 'bedtime',
    title: 'Stay within the chapter',
    desc: "When rewinding on stop, don't cross back into the previous chapter.",
    keywords: 'sleep chapter barrier rewind',
  },
  {
    section: 'sleepTimer',
    sectionLabel: 'Sleep timer',
    icon: 'bedtime',
    title: 'Fade out',
    desc: 'Gradually lower the volume before the sleep timer pauses.',
    keywords: 'sleep volume fade quiet',
  },
  {
    section: 'sleepTimer',
    sectionLabel: 'Sleep timer',
    icon: 'bedtime',
    title: 'Fade length',
    desc: 'How long the fade-out takes.',
    keywords: 'sleep volume fade duration',
  },
  {
    section: 'sleepTimer',
    sectionLabel: 'Sleep timer',
    icon: 'bedtime',
    title: 'Auto sleep timer',
    desc: 'Start a timer automatically when you press play during quiet hours.',
    keywords: 'automatic sleep bedtime night quiet hours',
  },
  {
    section: 'sleepTimer',
    sectionLabel: 'Sleep timer',
    icon: 'bedtime',
    title: 'Quiet hours',
    desc: 'When auto sleep should kick in.',
    keywords: 'night schedule bedtime start end time',
  },
  {
    section: 'sleepTimer',
    sectionLabel: 'Sleep timer',
    icon: 'bedtime',
    title: 'Auto duration',
    desc: 'Timer length auto sleep starts with.',
    keywords: 'sleep minutes length timer',
  },

  // ---- Book Club
  {
    section: 'bookClub',
    sectionLabel: 'Book Club',
    icon: 'groups',
    title: 'Note pops',
    desc: "Show a toast when playback crosses a note in a club you're in.",
    keywords: 'club notes toast popup spoiler',
  },

  // ---- Community
  {
    section: 'community',
    sectionLabel: 'Community',
    icon: 'groups',
    title: 'Share my reading list',
    desc: 'Appear on server reading lists with your name. Turn this off to stay hidden.',
    keywords: 'privacy share community reading list hide',
  },
  {
    section: 'community',
    sectionLabel: 'Community',
    icon: 'groups',
    title: "Share when I'm listening",
    desc: "Let other listeners see you're currently listening. Turn this off to stay hidden.",
    keywords: 'privacy share now playing presence hide',
  },

  // ---- Reading
  {
    section: 'reading',
    sectionLabel: 'Reading',
    icon: 'menu_book',
    title: 'Theme',
    desc: 'Reader colours: dark, sepia, paper, or light.',
    keywords: 'reader ebook sepia paper dark light colour color',
  },
  {
    section: 'reading',
    sectionLabel: 'Reading',
    icon: 'menu_book',
    title: 'Typeface',
    desc: 'Serif, sans, or a dyslexia-friendly face.',
    keywords: 'font reader ebook serif sans dyslexic accessibility',
  },
  {
    section: 'reading',
    sectionLabel: 'Reading',
    icon: 'menu_book',
    title: 'Text size',
    desc: 'How large the reader text is.',
    keywords: 'font size reader ebook bigger smaller zoom',
  },
  {
    section: 'reading',
    sectionLabel: 'Reading',
    icon: 'menu_book',
    title: 'Line spacing',
    desc: 'Compact, normal, or relaxed line height.',
    keywords: 'reader ebook leading line height',
  },
  {
    section: 'reading',
    sectionLabel: 'Reading',
    icon: 'menu_book',
    title: 'Page width',
    desc: 'Narrow, medium, or wide reader column.',
    keywords: 'reader ebook margins column',
  },
  {
    section: 'reading',
    sectionLabel: 'Reading',
    icon: 'menu_book',
    title: 'Layout',
    desc: 'Scroll continuously, or turn pages.',
    keywords: 'reader ebook scroll paged pages',
  },

  // ---- AI apps
  {
    section: 'aiApps',
    sectionLabel: 'AI apps',
    icon: 'smart_toy',
    title: 'Connect an AI app',
    desc: 'Talk to Claude or another AI app about your books.',
    keywords: 'ai claude mcp connector chatgpt assistant recommend chat',
  },
  {
    section: 'aiApps',
    sectionLabel: 'AI apps',
    icon: 'smart_toy',
    title: 'Connection address',
    desc: 'The address you paste into an AI app.',
    keywords: 'ai mcp url server address copy claude connector',
  },

  // ---- Integrations
  {
    section: 'integrations',
    sectionLabel: 'Integrations',
    icon: 'hub',
    title: 'Goodreads',
    desc: 'Show a Goodreads link on book pages.',
    keywords: 'external link book site',
  },
  {
    section: 'integrations',
    sectionLabel: 'Integrations',
    icon: 'hub',
    title: 'Audible',
    desc: 'Show an Audible link on book pages.',
    keywords: 'external link book site',
  },
  {
    section: 'integrations',
    sectionLabel: 'Integrations',
    icon: 'hub',
    title: 'Hardcover',
    desc: 'Connect Hardcover to sync your reading.',
    keywords: 'external link book site sync account',
  },
  {
    section: 'integrations',
    sectionLabel: 'Integrations',
    icon: 'hub',
    title: 'Import from Goodreads',
    desc: 'Bring your Goodreads shelves in.',
    keywords: 'import csv shelves migrate',
  },

  // ---- Search
  {
    section: 'search',
    sectionLabel: 'Search',
    icon: 'search',
    title: 'Search outside your library',
    desc: "Also find audiobooks you don't own yet, so you can request them.",
    keywords: 'external sources discover request wishlist',
  },

  // ---- HearthShelf
  {
    section: 'profile',
    sectionLabel: 'HearthShelf Account',
    icon: 'manage_accounts',
    title: 'HearthShelf Account',
    desc: 'Email, password, security, connected accounts, and active devices.',
    keywords: 'sign in login password email delete account security devices',
  },
  {
    section: 'servers',
    sectionLabel: 'My servers',
    icon: 'dns',
    title: 'My servers',
    desc: 'Every HearthShelf server you can reach, in one place.',
    keywords: 'link pair server connect unlink code',
  },
  {
    section: 'plan',
    sectionLabel: 'Subscription',
    icon: 'workspace_premium',
    title: 'Subscription',
    desc: 'Your plan and what it includes.',
    keywords: 'billing plan pro upgrade payment free',
  },
]

/**
 * Rank index entries against a query. Scores by where the match lands - title
 * beats section label beats description beats keywords - so "theme" surfaces the
 * Appearance and Reading theme rows above anything that merely mentions themes.
 * Every whitespace-separated term must match somewhere, so "reader theme" narrows
 * instead of widening.
 */
export function searchSettings(query: string): SettingEntry[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return []

  const scored: { entry: SettingEntry; score: number }[] = []
  for (const entry of SETTINGS_INDEX) {
    const title = entry.title.toLowerCase()
    const label = entry.sectionLabel.toLowerCase()
    const desc = (entry.desc ?? '').toLowerCase()
    const keywords = (entry.keywords ?? '').toLowerCase()

    let score = 0
    let matchedAll = true
    for (const term of terms) {
      if (title.startsWith(term)) score += 100
      else if (title.includes(term)) score += 60
      else if (label.includes(term)) score += 30
      else if (desc.includes(term)) score += 12
      else if (keywords.includes(term)) score += 8
      else {
        matchedAll = false
        break
      }
    }
    if (matchedAll) scored.push({ entry, score })
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.entry)
}
