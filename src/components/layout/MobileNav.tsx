import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { useQuery } from '@tanstack/react-query'
import { useActiveLibrary, libraryIcon } from '@/hooks/useActiveLibrary'
import { useActiveServer } from '@/hooks/useActiveServer'
import { Avatar } from '@/components/common/Avatar'
import { Icon } from '@/components/common/Icon'
import { getMe } from '@/api/absLibrary'
import { fetchAdminMe, ApiError, forgetRemembered } from '@/api/controlPlane'
import { PinEntryOverlay } from '@/components/account/PinEntryOverlay'
import { useRememberedAccounts, type RememberedAccount } from '@/store/rememberedAccounts'
import { useAccountSwitch } from '@/auth/useAccountSwitch'

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
  const { server, target } = useActiveServer()
  const { libraries, active, select } = useActiveLibrary()
  const isPodcast = active?.mediaType === 'podcast'

  const remembered = useRememberedAccounts((s) => s.accounts)
  const forgetLocal = useRememberedAccounts((s) => s.forget)
  const { switchTo, loginWithPassword, signInAnotherUser } = useAccountSwitch()
  const [pinFor, setPinFor] = useState<RememberedAccount | null>(null)
  const [forgetFor, setForgetFor] = useState<RememberedAccount | null>(null)

  const others = remembered.filter((a) => a.userId !== user?.id)
  const doSwitch = async (account: RememberedAccount, pin?: string): Promise<boolean> => {
    const res = await switchTo(account, pin)
    if (res.ok) {
      window.location.assign('/')
      return true
    }
    if (res.reason === 'pin') {
      setPinFor(account)
      return false
    }
    await loginWithPassword()
    return false
  }

  const onForgetTap = (account: RememberedAccount, e: React.MouseEvent) => {
    e.stopPropagation()
    if (account.hasPin) {
      setForgetFor(account)
      return
    }
    if (!window.confirm(`Forget ${account.label} on this device?`)) return
    void forgetRemembered(account.handle).finally(() => forgetLocal(account.handle))
  }

  const verifyForgetPin = async (account: RememberedAccount, pin: string): Promise<boolean> => {
    try {
      await forgetRemembered(account.handle, { pin })
      forgetLocal(account.handle)
      return true
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) return false
      forgetLocal(account.handle)
      return true
    }
  }

  const forgotPin = async (account: RememberedAccount) => {
    if (
      !window.confirm(
        `This will remove ${account.label} from this device. You'll need to sign in again to use it here.`,
      )
    )
      return
    try {
      await forgetRemembered(account.handle, { confirmForgot: true })
    } finally {
      forgetLocal(account.handle)
      setForgetFor(null)
    }
  }

  const { data: adminMe } = useQuery({
    queryKey: ['admin-me'],
    queryFn: fetchAdminMe,
    retry: (count, e) =>
      !(e instanceof ApiError && (e.status === 403 || e.status === 401)) && count < 2,
    staleTime: 5 * 60_000,
  })

  // ABS *server* admin (distinct from the platform admin above). Gates the
  // Server (/config) drawer row, mirroring the desktop sidebar.
  const { data: absMe } = useQuery({
    queryKey: ['abs-me', target?.serverId],
    queryFn: () => getMe(target!),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
  const isServerAdmin = absMe?.type === 'admin' || absMe?.type === 'root'

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
  if (isServerAdmin) account.push({ id: 'config', icon: 'dns', label: 'Server', to: '/config' })
  if (adminMe)
    account.push({ id: 'admin', icon: 'shield_person', label: 'Platform admin', to: '/admin' })
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
          {others.length > 0 && (
            <>
              <div className="msheet-sec">Switch account</div>
              {others.map((a) => (
                <button
                  type="button"
                  key={a.handle}
                  className="msheet-row switch-row"
                  onClick={() => (a.hasPin ? setPinFor(a) : void doSwitch(a))}
                >
                  <span className="msheet-ic">
                    <Avatar name={a.label} imageUrl={a.imageUrl} size={26} />
                  </span>
                  <span className="msheet-label">{a.label}</span>
                  {a.hasPin && <Icon name="lock" className="switch-lock" />}
                  <span
                    className="switch-forget"
                    role="button"
                    aria-label={`Forget ${a.label} on this device`}
                    onClick={(e) => onForgetTap(a, e)}
                  >
                    <Icon name="close" />
                  </span>
                </button>
              ))}
            </>
          )}
          <div className="msheet-sec">Account</div>
          <button
            type="button"
            className="msheet-row"
            onClick={() => {
              onClose()
              void signInAnotherUser()
            }}
          >
            <span className="msheet-ic">
              <Icon name="person_add" />
            </span>
            <span className="msheet-label">Sign in another user</span>
          </button>
          <button
            type="button"
            className="msheet-row"
            onClick={() => {
              onClose()
              void loginWithPassword()
            }}
          >
            <span className="msheet-ic">
              <Icon name="password" />
            </span>
            <span className="msheet-label">Log in without remembering this account</span>
          </button>

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
                      <Icon
                        name="check"
                        className="msheet-chev"
                        style={{ color: 'var(--accent)' }}
                      />
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
            onClick={() => {
              onClose()
              void loginWithPassword()
            }}
          >
            <span className="msheet-ic">
              <Icon name="logout" />
            </span>
            <span className="msheet-label">Log out</span>
          </button>
        </div>
      </aside>

      {pinFor && (
        <PinEntryOverlay
          name={pinFor.label}
          imageUrl={pinFor.imageUrl}
          verify={(pin) => doSwitch(pinFor, pin)}
          onSuccess={() => setPinFor(null)}
          onCancel={() => setPinFor(null)}
        />
      )}

      {forgetFor && (
        <PinEntryOverlay
          name={forgetFor.label}
          imageUrl={forgetFor.imageUrl}
          title={`Enter ${forgetFor.label}'s PIN to forget this account`}
          verify={(pin) => verifyForgetPin(forgetFor, pin)}
          onSuccess={() => setForgetFor(null)}
          onCancel={() => setForgetFor(null)}
          footer={
            <button type="button" onClick={() => void forgotPin(forgetFor)}>
              Forgot PIN?
            </button>
          }
        />
      )}
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
