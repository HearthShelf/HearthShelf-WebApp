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
  const { itemCount, active: activeLib } = useActiveLibrary()
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

  const Item = ({ id, icon, label, to, badge }: NavItemDef) => {
    const active = group === id
    return (
      <button
        className={'nav-item' + (active ? ' active' : '')}
        onClick={() => navigate(to)}
      >
        <Icon name={icon} fill={active} />
        {label}
        {badge != null && <span className="ni-badge">{badge}</span>}
      </button>
    )
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="/flame.png" alt="" className="mark" />
        <Wordmark />
      </div>

      <nav className="nav">
        <Item id="home" icon="home" label="Home" to="/" />
        <Item id="library" icon="grid_view" label="Library" to="/library" badge={itemCount} />

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
