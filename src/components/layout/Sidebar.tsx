import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useUser, useClerk } from '@clerk/clerk-react'
import { useQuery } from '@tanstack/react-query'
import { Wordmark } from '@/components/Wordmark'
import { Avatar } from '@/components/common/Avatar'
import { Icon } from '@/components/common/Icon'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getMe } from '@/api/absLibrary'
import { fetchAdminMe, ApiError } from '@/api/controlPlane'
import { useRmabEnabled } from '@/hooks/useRmab'
import { useDiscoverEnabled, useQuestGiverEnabled } from '@/hooks/useQuestGiver'
import { useNavCollapsed, toggleNavCollapsed } from '@/hooks/useNavCollapsed'

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
  if (path.startsWith('/stats')) return 'stats'
  if (path.startsWith('/sessions')) return 'sessions'
  if (path.startsWith('/player')) return 'player'
  if (path.startsWith('/account')) return 'settings'
  if (path.startsWith('/config')) return 'config'
  return path.slice(1)
}

interface NavItemDef {
  id: string
  icon: string
  label: string
  to: string
  badge?: number | null
}

function UserMenu() {
  const { user } = useUser()
  const { signOut } = useClerk()
  const { server } = useActiveServer()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  // Platform-admin link, shown only to the platform_admins roster (403-aware).
  const { data: adminMe } = useQuery({
    queryKey: ['admin-me'],
    queryFn: fetchAdminMe,
    retry: (count, e) =>
      !(e instanceof ApiError && (e.status === 403 || e.status === 401)) && count < 2,
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  const name = user?.username || user?.firstName || user?.primaryEmailAddress?.emailAddress || '?'
  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }

  return (
    <div className="user-wrap" onClick={(e) => e.stopPropagation()}>
      {open && (
        <div className="user-menu">
          <button onClick={() => go('/account')}>
            <Icon name="person" /> Account settings
          </button>
          {adminMe && (
            <button onClick={() => go('/admin')}>
              <Icon name="manage_accounts" /> Platform admin
            </button>
          )}
          <div className="sep" />
          <button className="danger" onClick={() => signOut({ redirectUrl: '/sign-in' })}>
            <Icon name="logout" /> Log out
          </button>
        </div>
      )}
      <button
        className={'user-chip' + (open ? ' on' : '')}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={name} imageUrl={user?.imageUrl} size={36} />
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
  const navigate = useNavigate()
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
  const showFindGroup = questGiverEnabled || discoverEnabled || rmabEnabled

  const collapsed = useNavCollapsed()

  const Item = ({ id, icon, label, to, badge }: NavItemDef) => {
    const active = group === id
    return (
      <button
        className={'nav-item' + (active ? ' active' : '')}
        onClick={() => navigate(to)}
        // When collapsed the label is hidden, so expose it as a tooltip.
        title={collapsed ? label : undefined}
        aria-label={label}
      >
        <Icon name={icon} fill={active} />
        <span className="ni-label">{label}</span>
        {badge != null && <span className="ni-badge">{badge}</span>}
      </button>
    )
  }

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
        <Item id="home" icon="home" label="Home" to="/" />
        <Item id="library" icon="grid_view" label="Library" to="/library" />

        {isPodcast ? (
          <>
            <div className="nav-label">Podcasts</div>
            <Item id="podcasts" icon="podcasts" label="Latest" to="/podcasts/latest" />
            {isServerAdmin && (
              <>
                <Item id="podcasts" icon="add_circle" label="Add podcast" to="/podcasts/add" />
                <Item id="podcasts" icon="download" label="Download queue" to="/podcasts/queue" />
              </>
            )}
          </>
        ) : (
          <>
            <div className="nav-label">Shelves</div>
            <Item id="collections" icon="folder_special" label="Collections" to="/collections" />
            <Item id="playlists" icon="queue_music" label="Playlists" to="/playlists" />
          </>
        )}

        {showFindGroup && (
          <>
            <div className="nav-label">Find</div>
            {questGiverEnabled && (
              <Item id="questgiver" icon="favorite" label="QuestGiver" to="/questgiver" />
            )}
            {discoverEnabled && (
              <Item id="discover" icon="explore" label="Discover" to="/discover" />
            )}
            {rmabEnabled && (
              <Item id="requests" icon="cloud_download" label="Requests" to="/requests" />
            )}
          </>
        )}

        <div className="nav-label">Insights</div>
        <Item id="stats" icon="insights" label="Stats" to="/stats" />
        <Item id="sessions" icon="history" label="History" to="/sessions" />
        <Item id="player" icon="graphic_eq" label="Now playing" to="/player" />

        <div className="nav-sep" />
        {isServerAdmin && <Item id="config" icon="dns" label="Server" to="/config" />}
        <Item id="settings" icon="settings" label="Settings" to="/account" />
      </nav>

      <UserMenu />
    </aside>
  )
}
