import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams, Navigate } from 'react-router-dom'
import { UserProfile, useClerk } from '@clerk/clerk-react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Loader2, Sparkles, Check } from 'lucide-react'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useServers } from '@/hooks/useServers'
import { useActiveServer } from '@/hooks/useActiveServer'
import { fetchMyPlan, deleteMyAccount, ApiError, type Plan } from '@/api/controlPlane'
import { ServerRow } from '@/components/ServerRow'
import { LinkServerDialog } from '@/components/LinkServerDialog'
import { DeleteAccountDialog } from '@/components/DeleteAccountDialog'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/common/Icon'
import { PlaybackSettings } from '@/components/settings/PlaybackSettings'
import { QueueSettings } from '@/components/settings/QueueSettings'
import { ActiveServerMediaUI } from '@/components/shared/ActiveServerMediaUI'
import { CarModeSettings } from '@/components/settings/CarModeSettings'
import { SleepTimerSettings } from '@/components/settings/SleepTimerSettings'
import { BookClubSettings } from '@/components/settings/BookClubSettings'
import { ReadingSettings } from '@/components/settings/ReadingSettings'
import { AppearanceSettings } from '@/components/settings/AppearanceSettings'
import { IntegrationsSettings } from '@/components/settings/IntegrationsSettings'
import { SearchSettings } from '@/components/settings/SearchSettings'
import { CommunitySettings } from '@/components/settings/CommunitySettings'
import { AccountSettings } from '@/components/settings/AccountSettings'

type Section =
  | 'servers'
  | 'playback'
  | 'queue'
  | 'carMode'
  | 'sleepTimer'
  | 'bookClub'
  | 'reading'
  | 'appearance'
  | 'integrations'
  | 'search'
  | 'community'
  | 'account'
  | 'plan'
  | 'profile'

const NAV: { label: string; items: { id: Section; icon: string; label: string }[] }[] = [
  {
    label: 'You',
    items: [
      { id: 'account', icon: 'person', label: 'Account' },
      { id: 'appearance', icon: 'palette', label: 'Appearance' },
    ],
  },
  {
    label: 'Listening',
    items: [
      { id: 'playback', icon: 'graphic_eq', label: 'Playback' },
      { id: 'queue', icon: 'queue_music', label: 'Queue' },
      { id: 'carMode', icon: 'directions_car', label: 'Car mode' },
      { id: 'sleepTimer', icon: 'bedtime', label: 'Sleep timer' },
      { id: 'bookClub', icon: 'groups', label: 'Book Club' },
      { id: 'community', icon: 'groups', label: 'Community' },
    ],
  },
  {
    label: 'Reading',
    items: [{ id: 'reading', icon: 'menu_book', label: 'Reading' }],
  },
  {
    label: 'Library',
    items: [
      { id: 'integrations', icon: 'hub', label: 'Integrations' },
      { id: 'search', icon: 'search', label: 'Search' },
    ],
  },
  {
    label: 'HearthShelf',
    items: [
      { id: 'profile', icon: 'manage_accounts', label: 'HearthShelf Account' },
      { id: 'servers', icon: 'dns', label: 'My servers' },
      { id: 'plan', icon: 'workspace_premium', label: 'Subscription' },
    ],
  },
]

/**
 * Account hub. Three sections, mirroring the self-hosted Settings shell:
 *  - My servers: the linked HearthShelf servers (by NAME, never the Direct URL),
 *    with quick-open (sets active) and unlink, plus link-a-server.
 *  - Subscription: the user's plan, read from the control plane's entitlement
 *    seam. Billing isn't wired yet, so Pro is a "coming soon" upsell.
 *  - Profile & sign-in: Clerk's own UserProfile (email, password, devices,
 *    connected accounts), skinned to the dark shell.
 */
const SECTIONS = NAV.flatMap((g) => g.items.map((i) => i.id))
const DEFAULT_SECTION: Section = 'servers'

// Bare /account: on desktop redirect to the default section (the two-pane view
// always shows one); on a phone show the drill-down section list instead.
export function AccountIndexRedirect() {
  const isMobile = useIsMobile()
  if (isMobile) return <AccountPage menuMode />
  return <Navigate to={`/account/${DEFAULT_SECTION}`} replace />
}

export function AccountPage({ menuMode = false }: { menuMode?: boolean }) {
  const { section: param } = useParams()
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  // Unknown section ids fall back to the default rather than rendering blank.
  const section = (SECTIONS.includes(param as Section) ? param : DEFAULT_SECTION) as Section

  // On a phone the layout drills down: the bare /account shows the section list
  // (menu); picking a section shows its detail with a back button. Desktop keeps
  // both panes side by side.
  const mobileMenu = isMobile && menuMode
  const wrapMode = isMobile ? (mobileMenu ? ' cfg-menu' : ' cfg-detail') : ''

  const renderSection = () => {
    switch (section) {
      case 'servers':
        return <MyServers />
      case 'playback':
        return <PlaybackSettings />
      case 'queue':
        // The queue editor renders book covers (Cover -> useMediaUI), so it needs
        // the active-server MediaUI provider that the rest of /account runs
        // without. Scope it to this section so linking a server / other settings
        // stay reachable when no server is connected.
        return (
          <ActiveServerMediaUI>
            <QueueSettings />
          </ActiveServerMediaUI>
        )
      case 'carMode':
        return <CarModeSettings />
      case 'sleepTimer':
        return <SleepTimerSettings />
      case 'bookClub':
        return <BookClubSettings />
      case 'reading':
        return <ReadingSettings />
      case 'appearance':
        return <AppearanceSettings />
      case 'integrations':
        return <IntegrationsSettings />
      case 'search':
        return <SearchSettings />
      case 'community':
        return <CommunitySettings />
      case 'account':
        return <AccountSettings />
      case 'plan':
        return <Subscription />
      case 'profile':
        return <Profile />
      default:
        return <MyServers />
    }
  }

  return (
    <div className="page fade-in settings-shell">
      <div className="page-head">
        <div className="eyebrow">Make it yours</div>
        <h1 className="title-xl">Settings</h1>
      </div>

      <div className={'config-wrap' + wrapMode}>
        <nav className="config-nav">
          {NAV.map((group) => (
            <div key={group.label}>
              <div className="cn-label">{group.label}</div>
              {group.items.map((n) => (
                <button
                  key={n.id}
                  className={'cn-item' + (section === n.id ? ' on' : '')}
                  onClick={() => navigate(`/account/${n.id}`)}
                >
                  <Icon name={n.icon} fill={section === n.id} />
                  {n.label}
                  <Icon name="chevron_right" className="cn-chev" />
                </button>
              ))}
            </div>
          ))}
        </nav>
        {!mobileMenu && (
          <div className="config-body">
            {isMobile && (
              <button className="cfg-back" onClick={() => navigate('/account')}>
                <Icon name="arrow_back" /> All settings
              </button>
            )}
            {renderSection()}
          </div>
        )}
      </div>
    </div>
  )
}

function MyServers() {
  const { data: servers, isLoading } = useServers()
  const { server: active } = useActiveServer()
  const [linkOpen, setLinkOpen] = useState(false)
  const [params, setParams] = useSearchParams()

  // A /pair?code=... deep link lands here as /account/servers?code=... - open
  // the Link-a-server dialog pre-filled instead of making the user retype it.
  // The param is stripped right away so a refresh/back doesn't reopen it.
  const dialogCode = params.get('code') || ''
  useEffect(() => {
    if (!dialogCode) return
    setLinkOpen(true)
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('code')
        return next
      },
      { replace: true },
    )
    // dialogCode is read once on arrival; setParams/params intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogCode])

  return (
    <section>
      <div className="section-head">
        <Icon name="dns" />
        <h2>My servers</h2>
      </div>
      <p className="t-muted mb-5 text-[13px]">
        Every HearthShelf server you can reach, in one place. Open one to browse it.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-muted-foreground">
          <Loader2 className="animate-spin" size={18} />
          <span className="t-body">Loading your servers...</span>
        </div>
      ) : !servers || servers.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="font-medium text-card-foreground">No servers linked yet</p>
          <p className="t-muted mx-auto mt-1 max-w-sm text-[13px]">
            Link your HearthShelf server with the pairing code from its setup screen to reach your
            library from anywhere.
          </p>
          <div className="mt-5">
            <Button onClick={() => setLinkOpen(true)}>
              <Plus size={16} />
              Link a server
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ul className="grid gap-3">
            {servers.map((s) => (
              <ServerRow key={s.id} server={s} active={s.id === active?.id} />
            ))}
          </ul>
          <div className="mt-5">
            <Button variant="secondary" onClick={() => setLinkOpen(true)}>
              <Plus size={16} />
              Link another server
            </Button>
          </div>
        </>
      )}

      {linkOpen && (
        <LinkServerDialog onClose={() => setLinkOpen(false)} initialCode={dialogCode} />
      )}
    </section>
  )
}

function Subscription() {
  const { data: plan, isLoading } = useQuery<Plan>({
    queryKey: ['my-plan'],
    queryFn: fetchMyPlan,
    retry: (count, e) => !(e instanceof ApiError && e.status === 401) && count < 2,
    staleTime: 5 * 60_000,
  })
  const isPro = plan === 'pro'

  return (
    <section>
      <div className="section-head">
        <Icon name="workspace_premium" />
        <h2>Subscription</h2>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="t-eyebrow">Current plan</p>
            <p className="mt-1 text-[22px] font-bold text-card-foreground">
              {isLoading ? '...' : isPro ? 'HearthShelf Pro' : 'Free'}
            </p>
          </div>
          <span
            className={
              'rounded-full px-3 py-1 text-[12px] font-medium ' +
              (isPro ? 'bg-primary/15 text-primary' : 'bg-secondary text-secondary-foreground')
            }
          >
            {isPro ? 'Active' : 'No subscription'}
          </span>
        </div>

        <ul className="mt-5 grid gap-2.5">
          <PlanLine on>Browse your servers from anywhere</PlanLine>
          <PlanLine on>Sync progress across devices</PlanLine>
          <PlanLine on={isPro}>Send invites through HearthShelf email</PlanLine>
          <PlanLine on={isPro}>Premium web-only library features</PlanLine>
        </ul>

        {!isPro && (
          <div className="mt-6 flex items-center gap-3">
            <Button disabled title="Billing is coming soon">
              <Sparkles size={16} />
              Upgrade to Pro
            </Button>
            <span className="t-muted text-[12px]">Billing is coming soon.</span>
          </div>
        )}
      </div>
    </section>
  )
}

function PlanLine({ on, children }: { on?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 text-[14px]">
      <Check size={16} className={on ? 'text-primary' : 'text-muted-foreground/40'} />
      <span className={on ? 'text-card-foreground' : 'text-muted-foreground'}>{children}</span>
    </li>
  )
}

function Profile() {
  const { signOut } = useClerk()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleConfirmDelete() {
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteMyAccount()
      await signOut({ redirectUrl: '/sign-in?reason=deleted' })
    } catch (err) {
      setDeleting(false)
      setDeleteError(
        err instanceof ApiError
          ? err.message
          : 'Something went wrong deleting your data. Please try again.',
      )
    }
  }

  return (
    <section>
      <div className="section-head">
        <Icon name="manage_accounts" />
        <h2>HearthShelf Account</h2>
      </div>
      {/* Clerk owns identity: email, password, security, connected accounts,
          active devices. Skinned to the dark shell via clerkAppearance. */}
      <UserProfile routing="hash" />

      <div className="mt-8 rounded-xl border border-destructive/30 bg-card p-6">
        <p className="t-eyebrow text-destructive">Danger zone</p>
        <p className="t-muted mt-2 text-[13px]">
          Permanently delete your HearthShelf account and everything tied to it: linked-server
          pairings, plan info, remembered devices, and crash reports. This does not touch your own
          self-hosted server.
        </p>
        <div className="mt-4">
          <Button variant="destructive" onClick={() => setDialogOpen(true)}>
            Delete my HearthShelf data
          </Button>
        </div>
      </div>

      {dialogOpen && (
        <DeleteAccountDialog
          busy={deleting}
          error={deleteError}
          onConfirm={handleConfirmDelete}
          onCancel={() => {
            if (deleting) return
            setDialogOpen(false)
            setDeleteError(null)
          }}
        />
      )}
    </section>
  )
}
