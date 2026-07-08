import type { ReactNode } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getMe } from '@/api/absLibrary'
import { getUsers, getLibrariesAdmin, getServiceAccountIds, adminKeys, serviceAccountKeys } from '@/api/absAdmin'
import { getServerRuntime, hostedKeys } from '@/api/absHosted'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ConfigUsers } from '@/pages/config/ConfigUsers'
import { ConfigUserDetail } from '@/pages/config/ConfigUserDetail'
import { ConfigLibraries } from '@/pages/config/ConfigLibraries'
import { ConfigSessions } from '@/pages/config/ConfigSessions'
import { ConfigBackups } from '@/pages/config/ConfigBackups'
import { ConfigLogs } from '@/pages/config/ConfigLogs'
import { ConfigJobs } from '@/pages/config/ConfigJobs'
import { ConfigApiKeys } from '@/pages/config/ConfigApiKeys'
import { ConfigServiceAccounts } from '@/pages/config/ConfigServiceAccounts'
import { ConfigServerInfo } from '@/pages/config/ConfigServerInfo'
import { ConfigIntegrations } from '@/pages/config/ConfigIntegrations'
import { ConfigNotifications } from '@/pages/config/ConfigNotifications'
import { ConfigEmail } from '@/pages/config/ConfigEmail'
import { ConfigMeta } from '@/pages/config/ConfigMeta'
import { ConfigRss } from '@/pages/config/ConfigRss'
import { ConfigAuth } from '@/pages/config/ConfigAuth'
import { ConfigQuestGiver } from '@/pages/config/ConfigQuestGiver'
import { ConfigHosted } from '@/pages/config/ConfigHosted'
import { ConfigCommunity } from '@/pages/config/ConfigCommunity'
import { ConfigServerStats, ConfigLibraryStats } from '@/pages/config/ConfigStats'
import { StatsPage } from '@/pages/StatsPage'
import { ConfigStub } from '@/pages/config/ConfigStub'
import { AdvancedModeProvider, AdvancedToggle } from '@/pages/config/AdvancedMode'

interface NavEntry {
  id: string
  icon: string
  label: string
  badge?: number | null
}
interface NavGroup {
  label: string
  items: NavEntry[]
}

// LIVE sections (real components): 'users', 'libraries'. Everything else in the
// nav renders ConfigStub until a follow-up agent swaps it in. To make a section
// live: build its component, add a case to renderSection() below, and the nav
// item (which already exists) lights it up automatically.
export function ConfigShell({ menuMode = false }: { menuMode?: boolean }) {
  const { section = 'settings', userId } = useParams()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const { target, server } = useActiveServer()

  // Gate on the ABS *server* admin (distinct from the platform admin). A user who
  // can sign in but isn't an admin gets a clean "not authorized" panel.
  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ['abs-me', target?.serverId],
    queryFn: () => getMe(target!),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
  const isAdmin = me?.type === 'admin' || me?.type === 'root'

  // On a phone the two-pane layout drills down: the bare /config index shows the
  // section list (menu); picking a section shows its detail with a back button.
  // Desktop keeps both panes side by side.
  const mobileMenu = isMobile && menuMode

  const { data: libs } = useQuery({
    queryKey: adminKeys.libraries(target?.serverId ?? ''),
    queryFn: () => getLibrariesAdmin(target!),
    enabled: Boolean(target) && isAdmin,
    staleTime: 5 * 60 * 1000,
  })
  const { data: usersData } = useQuery({
    queryKey: adminKeys.users(target?.serverId ?? ''),
    queryFn: () => getUsers(target!),
    enabled: Boolean(target) && isAdmin,
    staleTime: 60 * 1000,
  })

  // Exclude service accounts from the Users badge count, matching the filter
  // ConfigUsers.tsx applies to the list itself (see its `serviceUsername` comment).
  const { data: trackedServiceIds } = useQuery({
    queryKey: serviceAccountKeys.ids(target?.serverId ?? ''),
    queryFn: () => getServiceAccountIds(target!),
    enabled: Boolean(target) && isAdmin,
    staleTime: 60 * 1000,
  })
  const { data: runtime } = useQuery({
    queryKey: hostedKeys.runtime(target?.serverId ?? ''),
    queryFn: () => getServerRuntime(target!),
    enabled: Boolean(target) && isAdmin,
    staleTime: 5 * 60 * 1000,
  })
  const serviceUsername = runtime?.serviceUsername ?? null
  const trackedServiceIdSet = new Set(trackedServiceIds?.ids ?? [])
  const humanUserCount = usersData?.users.filter(
    (u) =>
      !trackedServiceIdSet.has(u.id) && !(serviceUsername != null && u.username === serviceUsername),
  ).length

  if (!target || meLoading) {
    return <LoadingSpinner className="py-24" label="Loading server settings..." />
  }

  if (!isAdmin) {
    return (
      <div className="page">
        <div className="empty-state">
          <Icon name="lock" />
          <h3>Admins only</h3>
          <p>You need an admin account on this server to view its settings.</p>
        </div>
      </div>
    )
  }

  const groups: NavGroup[] = [
    {
      label: 'Server',
      items: [
        { id: 'settings', icon: 'tune', label: 'General' },
        {
          id: 'libraries',
          icon: 'video_library',
          label: 'Libraries',
          badge: libs?.libraries.length,
        },
        {
          id: 'users',
          icon: 'group',
          label: 'Users',
          badge: humanUserCount,
        },
        { id: 'service-accounts', icon: 'smart_toy', label: 'Service Accounts' },
        { id: 'apikeys', icon: 'key', label: 'API Keys' },
        { id: 'sessions', icon: 'graphic_eq', label: 'Listening Sessions' },
        { id: 'backups', icon: 'cloud_sync', label: 'Backups' },
        { id: 'tasks', icon: 'schedule', label: 'Tasks' },
        { id: 'logs', icon: 'terminal', label: 'Logs' },
      ],
    },
    {
      label: 'Content',
      items: [
        { id: 'integrations', icon: 'extension', label: 'Integrations' },
        { id: 'notifications', icon: 'notifications', label: 'Notifications' },
        { id: 'email', icon: 'mail', label: 'Email' },
        { id: 'meta', icon: 'sell', label: 'Metadata Utils' },
        { id: 'rss', icon: 'rss_feed', label: 'RSS Feeds' },
        { id: 'auth', icon: 'lock', label: 'Authentication' },
      ],
    },
    {
      label: 'Features',
      items: [
        { id: 'questgiver', icon: 'explore', label: 'QuestGiver' },
        { id: 'connect', icon: 'hub', label: 'HearthShelf Connect' },
      ],
    },
    {
      label: 'Community',
      items: [{ id: 'community', icon: 'groups', label: 'Community' }],
    },
    {
      label: 'Insights',
      items: [
        { id: 'mystats', icon: 'person', label: 'Your Stats' },
        { id: 'serverstats', icon: 'leaderboard', label: 'Server Stats' },
        { id: 'libstats', icon: 'insights', label: 'Library Stats' },
      ],
    },
  ]

  // The Users nav item stays active on the user-detail sub-route.
  const activeId = userId ? 'users' : section

  // section id -> component. Live sections render their real component; the rest
  // fall through to ConfigStub. Follow-up agents add a case here per section.
  const renderSection = (): ReactNode => {
    if (userId) return <ConfigUserDetail userId={userId} />
    switch (section) {
      case 'users':
        return <ConfigUsers />
      case 'libraries':
        return <ConfigLibraries />
      case 'sessions':
        return <ConfigSessions />
      case 'backups':
        return <ConfigBackups />
      case 'logs':
        return <ConfigLogs />
      case 'tasks':
        return <ConfigJobs />
      case 'apikeys':
        return <ConfigApiKeys />
      case 'service-accounts':
        return <ConfigServiceAccounts />
      case 'settings':
        return <ConfigServerInfo />
      case 'integrations':
        return <ConfigIntegrations />
      case 'notifications':
        return <ConfigNotifications />
      case 'email':
        return <ConfigEmail />
      case 'meta':
        return <ConfigMeta />
      case 'rss':
        return <ConfigRss />
      case 'auth':
        return <ConfigAuth />
      case 'questgiver':
        return <ConfigQuestGiver />
      case 'connect':
        return <ConfigHosted />
      case 'community':
        return <ConfigCommunity />
      case 'mystats':
        return <StatsPage />
      case 'serverstats':
        return <ConfigServerStats />
      case 'libstats':
        return <ConfigLibraryStats />
      default:
        return <ConfigStub section={section} />
    }
  }

  const wrapMode = isMobile ? (mobileMenu ? ' cfg-menu' : ' cfg-detail') : ''

  return (
    <AdvancedModeProvider>
      <div className={'page config-wrap fade-in' + wrapMode}>
        <nav className="config-nav">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="cn-label">{g.label}</div>
              {g.items.map((it) => (
                <button
                  key={it.id}
                  className={'cn-item' + (activeId === it.id ? ' on' : '')}
                  onClick={() => navigate(`/config/${it.id}`)}
                >
                  <Icon name={it.icon} fill={activeId === it.id} />
                  {it.label}
                  {it.badge != null && <span className="cn-badge">{it.badge}</span>}
                  <Icon name="chevron_right" className="cn-chev" />
                </button>
              ))}
            </div>
          ))}
          <div className="config-foot">
            HearthShelf · server admin
            <br />
            {server?.name ?? 'HearthShelf'}
          </div>
          <AdvancedToggle />
        </nav>
        {!mobileMenu && (
          <div className="config-body">
            {isMobile && (
              <button className="cfg-back" onClick={() => navigate('/config')}>
                <Icon name="arrow_back" /> All settings
              </button>
            )}
            {renderSection()}
          </div>
        )}
      </div>
    </AdvancedModeProvider>
  )
}

// Bare /config: on desktop redirect to the default section (the two-pane view
// always shows a section); on a phone show the drill-down section list instead.
export function ConfigIndexRedirect() {
  const isMobile = useIsMobile()
  if (isMobile) return <ConfigShell menuMode />
  return <Navigate to="/config/settings" replace />
}
