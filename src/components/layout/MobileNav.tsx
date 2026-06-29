import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useUser, useClerk } from '@clerk/clerk-react'
import { useQuery } from '@tanstack/react-query'
import { useActiveLibrary, libraryIcon } from '@/hooks/useActiveLibrary'
import { useActiveServer } from '@/hooks/useActiveServer'
import { Avatar } from '@/components/common/Avatar'
import { Icon } from '@/components/common/Icon'
import { fetchAdminMe, ApiError } from '@/api/controlPlane'

// Which primary tab (or "more") a path belongs to, so the matching bottom-bar
// item lights up. Mirrors the sidebar grouping.
function tabForPath(path: string): string {
  if (path === '/') return 'home'
  if (path.startsWith('/player')) return 'player'
  if (
    path.startsWith('/library') ||
    path.startsWith('/series') ||
    path.startsWith('/book') ||
    path.startsWith('/author') ||
    path.startsWith('/narrators') ||
    path.startsWith('/search')
  )
    return 'library'
  return 'more'
}

interface PrimaryTab {
  id: string
  icon: string
  label: string
  to: string
}

const PRIMARY: PrimaryTab[] = [
  { id: 'home', icon: 'home', label: 'Home', to: '/' },
  { id: 'library', icon: 'grid_view', label: 'Library', to: '/library' },
  { id: 'player', icon: 'graphic_eq', label: 'Now playing', to: '/player' },
]

interface DrawerRowDef {
  id: string
  icon: string
  label: string
  to: string
  badge?: number | null
}

function DrawerRow({
  id,
  icon,
  label,
  to,
  badge,
  activeTab,
  onGo,
}: DrawerRowDef & { activeTab: string; onGo: (to: string) => void }) {
  const active = activeTab === id
  return (
    <button
      type="button"
      className={'msheet-row' + (active ? ' active' : '')}
      onClick={() => onGo(to)}
    >
      <span className="msheet-ic">
        <Icon name={icon} fill={active} />
      </span>
      <span className="msheet-label">{label}</span>
      {badge != null && <span className="ni-badge">{badge}</span>}
      <Icon name="chevron_right" className="msheet-chev" />
    </button>
  )
}

// Mobile "More" bottom sheet: server/library switcher + grouped overflow
// destinations + account.
function MobileDrawer({
  open,
  onClose,
  activeTab,
}: {
  open: boolean
  onClose: () => void
  activeTab: string
}) {
  const navigate = useNavigate()
  const { user } = useUser()
  const { signOut } = useClerk()
  const { server } = useActiveServer()
  const { libraries, active, select } = useActiveLibrary()
  const isPodcast = active?.mediaType === 'podcast'

  const { data: adminMe } = useQuery({
    queryKey: ['admin-me'],
    queryFn: fetchAdminMe,
    retry: (count, e) =>
      !(e instanceof ApiError && (e.status === 403 || e.status === 401)) && count < 2,
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const go = (to: string) => {
    onClose()
    navigate(to)
  }

  const name = user?.username || user?.firstName || user?.primaryEmailAddress?.emailAddress || '?'

  const groups: { sec: string; rows: DrawerRowDef[] }[] = []
  if (!isPodcast)
    groups.push({
      sec: 'Shelves',
      rows: [
        { id: 'collections', icon: 'folder_special', label: 'Collections', to: '/collections' },
        { id: 'playlists', icon: 'queue_music', label: 'Playlists', to: '/playlists' },
      ],
    })
  groups.push({
    sec: 'Insights',
    rows: [
      { id: 'stats', icon: 'insights', label: 'Stats', to: '/stats' },
      { id: 'sessions', icon: 'history', label: 'Listening history', to: '/sessions' },
    ],
  })
  const account: DrawerRowDef[] = [
    { id: 'settings', icon: 'person', label: 'Account', to: '/account' },
  ]
  if (adminMe) account.push({ id: 'admin', icon: 'shield_person', label: 'Platform admin', to: '/admin' })
  groups.push({ sec: 'Account', rows: account })

  return (
    <div className={'mdrawer-root' + (open ? ' open' : '')} aria-hidden={!open}>
      <div className={'mdrawer-scrim' + (open ? ' open' : '')} onClick={onClose} />
      <aside className={'mdrawer' + (open ? ' open' : '')} role="dialog" aria-label="More">
        <div className="msheet-grab" />
        <div className="msheet-user">
          <Avatar name={name} imageUrl={user?.imageUrl} size={46} />
          <div className="msheet-umeta">
            <div className="msheet-uname">{name}</div>
            {/* Server NAME, never the Direct URL. */}
            <div className="msheet-usub">{server?.name ?? 'HearthShelf'}</div>
          </div>
          <button type="button" className="msheet-close" onClick={onClose} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>

        <div className="msheet-scroll">
          {libraries.length > 1 && (
            <>
              <div className="msheet-sec">Library</div>
              {libraries.map((l) => {
                const on = l.id === active?.id
                return (
                  <button
                    type="button"
                    key={l.id}
                    className={'msheet-row' + (on ? ' active' : '')}
                    onClick={() => {
                      select(l.id)
                      onClose()
                      navigate('/library')
                    }}
                  >
                    <span className="msheet-ic">
                      <Icon name={libraryIcon(l)} fill={on} />
                    </span>
                    <span className="msheet-label">
                      {l.name}
                      <span className="msheet-sublabel">
                        {l.mediaType === 'podcast' ? 'Podcasts' : 'Audiobooks'}
                      </span>
                    </span>
                    {on && (
                      <Icon name="check" className="msheet-chev" style={{ color: 'var(--accent)' }} />
                    )}
                  </button>
                )
              })}
            </>
          )}

          {groups.map((g) => (
            <div key={g.sec}>
              <div className="msheet-sec">{g.sec}</div>
              {g.rows.map((r) => (
                <DrawerRow key={r.id} {...r} activeTab={activeTab} onGo={go} />
              ))}
            </div>
          ))}

          <button
            type="button"
            className="msheet-row danger"
            onClick={() => signOut({ redirectUrl: '/sign-in' })}
          >
            <span className="msheet-ic">
              <Icon name="logout" />
            </span>
            <span className="msheet-label">Log out</span>
          </button>
        </div>
      </aside>
    </div>
  )
}

export function MobileNav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const tab = tabForPath(pathname)
  const onPrimary = PRIMARY.some((t) => t.id === tab)

  return (
    <>
      <nav className="mtab" role="navigation" aria-label="Primary">
        {PRIMARY.map((t) => {
          const active = !drawerOpen && tab === t.id
          return (
            <button
              type="button"
              key={t.id}
              className={'mtab-item' + (active ? ' active' : '')}
              onClick={() => {
                setDrawerOpen(false)
                navigate(t.to)
              }}
            >
              <Icon name={t.icon} fill={active} />
              <span>{t.label}</span>
            </button>
          )
        })}
        <button
          type="button"
          className={'mtab-item' + (drawerOpen || !onPrimary ? ' active' : '')}
          onClick={() => setDrawerOpen((o) => !o)}
        >
          <Icon name="menu" />
          <span>More</span>
        </button>
      </nav>
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} activeTab={tab} />
    </>
  )
}
