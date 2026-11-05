import { Fragment, useState, useEffect, useCallback, useMemo, type MouseEvent } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useUser } from '@/auth/useAuth'
import { useQuery } from '@tanstack/react-query'
import { Wordmark } from '@/components/Wordmark'
import { Avatar } from '@/components/common/Avatar'
import { Icon } from '@/components/common/Icon'
import { AccountSwitcher } from '@/components/account/AccountSwitcher'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getMe } from '@/api/absLibrary'
import { useAdminMe } from '@/hooks/useAdminMe'
import { useRmabEnabled } from '@/hooks/useRmab'
import { useDiscoverEnabled, useQuestGiverEnabled } from '@/hooks/useQuestGiver'
import { useNavCollapsed, toggleNavCollapsed } from '@/hooks/useNavCollapsed'
import { useCarMode } from '@/hooks/useCarMode'
import { useSettingsStore } from '@/store/settingsStore'
import { useLongPress } from '@/hooks/useLongPress'
import { NavContextMenu } from '@/components/layout/NavContextMenu'
import { NavMoreMenu } from '@/components/layout/NavMoreMenu'
import {
  applyHidden,
  buildNav,
  type NavEntry,
  type NavMenuTarget,
  type NavSection,
} from '@/components/layout/navMenu'

// Which nav group a path belongs to. Browse surfaces (series, authors, search,
// item detail) keep Library lit, matching the self-hosted shell.
function groupForPath(path: string): string {
  if (path === '/') return 'home'
  if (
    path.startsWith('/library') ||
    path.startsWith('/series') ||
    path.startsWith('/book') ||
    path.startsWith('/author') ||
    path.startsWith('/narrators') ||
    path.startsWith('/search') ||
    path.startsWith('/podcast/')
  )
    return 'library'
  if (path.startsWith('/podcasts/')) return 'podcasts'
  if (path.startsWith('/collections')) return 'collections'
  if (path.startsWith('/playlists')) return 'playlists'
  if (path.startsWith('/questgiver')) return 'questgiver'
  if (path.startsWith('/discover')) return 'discover'
  if (path.startsWith('/requests')) return 'requests'
  if (path.startsWith('/upcoming')) return 'upcoming'
  if (path.startsWith('/stats')) return 'stats'
  if (path.startsWith('/finished')) return 'finished'
  if (path.startsWith('/clubs') || path.startsWith('/club/')) return 'clubs'
  if (path.startsWith('/sessions')) return 'sessions'
  if (path.startsWith('/player')) return 'player'
  if (path.startsWith('/account')) return 'settings'
  if (path.startsWith('/config')) return 'config'
  return path.slice(1)
}

interface NavItemDef {
  entry: NavEntry
  badge?: number | null
  active: boolean
  collapsed: boolean
  onMenu?: (x: number, y: number) => void
}

// Right-click and press-and-hold both open the row's menu. Keyboard menu keys
// report no pointer position, so fall back to the row itself.
function useNavMenuTrigger(onMenu?: (x: number, y: number) => void) {
  const press = useLongPress((x, y) => onMenu?.(x, y))
  if (!onMenu) return {}
  return {
    ...press.handlers,
    onContextMenu(e: MouseEvent<HTMLElement>) {
      e.preventDefault()
      press.cancel()
      if (e.clientX || e.clientY) return onMenu(e.clientX, e.clientY)
      const rect = e.currentTarget.getBoundingClientRect()
      onMenu(rect.left + 24, rect.bottom)
    },
  }
}

// Declared at module scope, NOT inside Sidebar. A component defined in the
// render body is a new type every render, so React unmounts and remounts every
// nav button instead of reconciling it - which restarts the CSS background
// transition and made the hover fill flash once a second while audio played
// (the player's position tick re-renders this whole shell).
function Item({ entry, badge, active, collapsed, onMenu }: NavItemDef) {
  const { icon, label, to } = entry
  const trigger = useNavMenuTrigger(onMenu)
  return (
    // A real <Link> (not a button) so the browser owns the URL: ctrl/cmd-click
    // and middle-click open the destination in a new tab, and hovering shows the
    // target. Router navigation on a plain click is handled by Link itself.
    <Link
      to={to}
      className={'nav-item' + (active ? ' active' : '')}
      // When collapsed the label is hidden, so expose it as a tooltip.
      title={collapsed ? label : undefined}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      draggable={false}
      {...trigger}
    >
      <Icon name={icon} fill={active} />
      <span className="ni-label">{label}</span>
      {badge != null && <span className="ni-badge">{badge}</span>}
    </Link>
  )
}

function SectionLabel({
  label,
  onMenu,
}: {
  label: string
  onMenu?: (x: number, y: number) => void
}) {
  const trigger = useNavMenuTrigger(onMenu)
  return (
    <div className="nav-label" {...trigger}>
      {label}
    </div>
  )
}

const SETTINGS_ENTRY: NavEntry = {
  id: 'settings',
  icon: 'settings',
  label: 'Settings',
  to: '/account',
  group: 'settings',
}

function UserMenu() {
  const { user } = useUser()
  const { server, target } = useActiveServer()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  // Cache-busts our own avatar <img> when the Gravatar preference changes -
  // see AccountSettings.tsx for why the URL alone won't pick this up.
  const avatarVersion = useSettingsStore((s) => s.meta.useGravatar)

  const { data: absMe } = useQuery({
    queryKey: ['abs-me', target?.serverId],
    queryFn: () => getMe(target!),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })

  // Platform-admin link, shown only to the platform_admins roster (403-aware).
  const { data: adminMe } = useAdminMe()

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  const name = user?.username || user?.firstName || user?.primaryEmailAddress?.emailAddress || '?'

  return (
    <div className="user-wrap" onClick={(e) => e.stopPropagation()}>
      {open && (
        <div className="user-menu">
          <AccountSwitcher
            onDone={() => setOpen(false)}
            onNavigate={navigate}
            showAdmin={!!adminMe}
          />
        </div>
      )}
      <button className={'user-chip' + (open ? ' on' : '')} onClick={() => setOpen((o) => !o)}>
        <Avatar name={name} target={target} userId={absMe?.id} version={avatarVersion} size={36} />
        <span className="u-meta">
          <span className="u-name">{name}</span>
          {/* The server's friendly NAME - never the Direct URL or a UUID. */}
          <span className="u-sub">{server?.name ?? 'HearthShelf'}</span>
        </span>
        <Icon name="expand_less" className="u-chev" />
      </button>
    </div>
  )
}

export function Sidebar() {
  const { pathname } = useLocation()
  const { target } = useActiveServer()
  const { active: activeLib } = useActiveLibrary()
  const group = groupForPath(pathname)
  const isPodcast = activeLib?.mediaType === 'podcast'

  // ABS *server* admin (distinct from the platform admin). Gates the podcast
  // admin items (Add / Download queue) AND the Server (/config) nav link below.
  // Queried whenever we have a target so the Server link can appear on any
  // library type, not just podcasts.
  const { data: absMe } = useQuery({
    queryKey: ['abs-me', target?.serverId],
    queryFn: () => getMe(target!),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
  const isServerAdmin = absMe?.type === 'admin' || absMe?.type === 'root'

  // ReadMeABook feature gates: each nav item shows ONLY when the active server's
  // HearthShelf backend reports the feature enabled (defaults false until known,
  // so nothing flickers in on a server without the feature).
  const questGiverEnabled = useQuestGiverEnabled()
  const discoverEnabled = useDiscoverEnabled()
  const rmabEnabled = useRmabEnabled()

  // Car mode trims the nav to driving-friendly destinations: discovery, stats,
  // listening history, and server admin all drop out (not tasks you do at the
  // wheel), leaving Home / Library / Shelves / Now playing / Settings plus an
  // Exit. The remaining items also render as big square tiles (CSS, gated on
  // .app.car-shell) - larger icon over a label - for large in-car touchscreens.
  const carMode = useCarMode()
  const setSetting = useSettingsStore((s) => s.set)
  const hiddenIds = useSettingsStore((s) => s.webNavHidden)

  const collapsed = useNavCollapsed()

  const [menu, setMenu] = useState<{ x: number; y: number; target: NavMenuTarget } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  // Car mode keeps its short fixed list, so nothing is hidden or customized there.
  const nav = useMemo(() => {
    const layout = buildNav({
      isPodcast,
      isServerAdmin,
      questGiverEnabled,
      discoverEnabled,
      rmabEnabled,
      carMode,
    })
    return applyHidden(layout, new Set(carMode ? [] : hiddenIds))
  }, [
    isPodcast,
    isServerAdmin,
    questGiverEnabled,
    discoverEnabled,
    rmabEnabled,
    carMode,
    hiddenIds,
  ])

  const hide = (id: string) => setSetting('webNavHidden', [...new Set([...hiddenIds, id])])
  const show = (id: string) =>
    setSetting(
      'webNavHidden',
      hiddenIds.filter((hidden) => hidden !== id),
    )
  const showAll = () => setSetting('webNavHidden', [])
  const openMenu = (target: NavMenuTarget) =>
    carMode ? undefined : (x: number, y: number) => setMenu({ x, y, target })

  const renderItem = (entry: NavEntry, section?: NavSection, pinned?: boolean) => (
    <Item
      key={entry.id}
      entry={entry}
      collapsed={collapsed}
      active={group === entry.group}
      onMenu={openMenu({ entry, section, pinned })}
    />
  )

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="/flame.png" alt="" className="mark" />
        <Wordmark />
        <button
          className="nav-collapse-btn"
          onClick={toggleNavCollapsed}
          title="Collapse menu"
          aria-label="Collapse menu"
        >
          <Icon name="menu_open" />
        </button>
      </div>

      {/* Expand affordance, shown only in the collapsed rail (CSS-gated). */}
      <button
        className="nav-item nav-collapse-rail"
        onClick={toggleNavCollapsed}
        title="Expand menu"
        aria-label="Expand menu"
      >
        <Icon name="menu" />
      </button>

      <nav className="nav">
        {nav.top.map((entry) => renderItem(entry))}

        {nav.sections.map((section) => (
          <Fragment key={section.id}>
            <SectionLabel label={section.label} onMenu={openMenu({ section })} />
            {section.items.map((entry) => renderItem(entry, section))}
          </Fragment>
        ))}

        {nav.more.length > 0 && (
          <NavMoreMenu
            groups={nav.more}
            activeGroup={group}
            collapsed={collapsed}
            onShow={show}
            onShowAll={showAll}
          />
        )}

        <div className="nav-sep" />
        {nav.footer.map((entry) => renderItem(entry))}
        {renderItem(SETTINGS_ENTRY, undefined, true)}
        {carMode && (
          <button
            className="nav-item"
            onClick={() => setSetting('carMode', 'off')}
            aria-label="Exit car mode"
            title="Exit car mode"
          >
            <Icon name="close_fullscreen" />
            <span className="ni-label">Exit car mode</span>
          </button>
        )}
      </nav>

      {menu && (
        <NavContextMenu
          x={menu.x}
          y={menu.y}
          target={menu.target}
          hasHidden={nav.more.length > 0}
          onHide={hide}
          onShowAll={showAll}
          onClose={closeMenu}
        />
      )}

      <UserMenu />
    </aside>
  )
}
