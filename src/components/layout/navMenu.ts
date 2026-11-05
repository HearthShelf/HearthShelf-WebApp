// The left menu as data, so the sidebar, its right-click menu and the More menu
// all work from one list of what the user can hide.

export interface NavEntry {
  id: string
  icon: string
  label: string
  to: string
  // The path group (see groupForPath) that lights this row up.
  group: string
}

export interface NavSection {
  id: string
  label: string
  items: NavEntry[]
}

export interface NavLayout {
  top: NavEntry[]
  sections: NavSection[]
  footer: NavEntry[]
}

// What a right-click or press-and-hold landed on. A section label has no entry.
export interface NavMenuTarget {
  entry?: NavEntry
  section?: NavSection
  pinned?: boolean
}

export interface NavMoreGroup {
  key: string
  label?: string
  // Set when the whole section is hidden, so it comes back as one.
  sectionId?: string
  items: NavEntry[]
}

export interface NavFlags {
  isPodcast: boolean
  isServerAdmin: boolean
  questGiverEnabled: boolean
  discoverEnabled: boolean
  rmabEnabled: boolean
  carMode: boolean
}

const entry = (id: string, icon: string, label: string, to: string, group = id): NavEntry => ({
  id,
  icon,
  label,
  to,
  group,
})

const NOW_PLAYING = entry('player', 'graphic_eq', 'Now playing', '/player')

export function buildNav(flags: NavFlags): NavLayout {
  const { isPodcast, isServerAdmin, questGiverEnabled, discoverEnabled, rmabEnabled, carMode } =
    flags
  const top = [
    entry('home', 'home', 'Home', '/'),
    entry('library', 'grid_view', 'Library', '/library'),
  ]
  const sections: NavSection[] = []

  if (isPodcast) {
    sections.push({
      id: 'group:podcasts',
      label: 'Podcasts',
      items: [
        entry('podcasts-latest', 'podcasts', 'Latest', '/podcasts/latest', 'podcasts'),
        ...(isServerAdmin
          ? [
              entry('podcasts-add', 'add_circle', 'Add podcast', '/podcasts/add', 'podcasts'),
              entry('podcasts-queue', 'download', 'Download queue', '/podcasts/queue', 'podcasts'),
            ]
          : []),
      ],
    })
  } else {
    sections.push({
      id: 'group:shelves',
      label: 'Shelves',
      items: [
        entry('collections', 'folder_special', 'Collections', '/collections'),
        entry('playlists', 'queue_music', 'Playlists', '/playlists'),
      ],
    })
  }

  if (!carMode && (questGiverEnabled || discoverEnabled || rmabEnabled)) {
    sections.push({
      id: 'group:find',
      label: 'Find',
      items: [
        ...(questGiverEnabled
          ? [entry('questgiver', 'favorite', 'QuestGiver', '/questgiver')]
          : []),
        ...(discoverEnabled ? [entry('discover', 'explore', 'Discover', '/discover')] : []),
        // Not gated on the request backend: following only notifies, and works
        // on every server.
        entry('upcoming', 'event_upcoming', 'Upcoming', '/upcoming'),
        ...(rmabEnabled ? [entry('requests', 'cloud_download', 'Requests', '/requests')] : []),
      ],
    })
  }

  if (carMode) {
    top.push(NOW_PLAYING)
  } else {
    sections.push(
      {
        id: 'group:community',
        label: 'Community',
        items: [entry('clubs', 'groups_3', 'Book clubs', '/clubs')],
      },
      {
        id: 'group:insights',
        label: 'Insights',
        items: [
          entry('stats', 'insights', 'Stats', '/stats'),
          entry('finished', 'check_circle', 'Finished', '/finished'),
          entry('history', 'history', 'History', '/sessions', 'sessions'),
          NOW_PLAYING,
        ],
      },
    )
  }

  const footer =
    !carMode && isServerAdmin ? [entry('server', 'dns', 'Server', '/config', 'config')] : []
  return { top, sections, footer }
}

// Splits the menu into what stays on show and what moves to More.
export function applyHidden(layout: NavLayout, hidden: ReadonlySet<string>) {
  const shown = (items: NavEntry[]) => items.filter((i) => !hidden.has(i.id))
  const tucked = (items: NavEntry[]) => items.filter((i) => hidden.has(i.id))
  const more: NavMoreGroup[] = []

  const topHidden = tucked(layout.top)
  if (topHidden.length) more.push({ key: 'top', items: topHidden })

  const sections: NavSection[] = []
  for (const section of layout.sections) {
    if (hidden.has(section.id)) {
      more.push({
        key: section.id,
        label: section.label,
        sectionId: section.id,
        items: section.items,
      })
      continue
    }
    const items = shown(section.items)
    if (items.length) sections.push({ ...section, items })
    const partly = tucked(section.items)
    if (partly.length) more.push({ key: section.id, label: section.label, items: partly })
  }

  const footerHidden = tucked(layout.footer)
  if (footerHidden.length) more.push({ key: 'footer', items: footerHidden })

  return { top: shown(layout.top), sections, footer: shown(layout.footer), more }
}
