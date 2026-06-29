import { useState } from 'react'
import { UserProfile } from '@clerk/clerk-react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Loader2, Sparkles, Check } from 'lucide-react'
import { useServers } from '@/hooks/useServers'
import { useActiveServer } from '@/hooks/useActiveServer'
import { fetchMyPlan, ApiError, type Plan } from '@/api/controlPlane'
import { ServerRow } from '@/components/ServerRow'
import { LinkServerDialog } from '@/components/LinkServerDialog'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/common/Icon'
import { PlaybackSettings } from '@/components/settings/PlaybackSettings'
import { ReadingSettings } from '@/components/settings/ReadingSettings'
import { AppearanceSettings } from '@/components/settings/AppearanceSettings'
import { ConnectionsSettings } from '@/components/settings/ConnectionsSettings'
import { AccountSettings } from '@/components/settings/AccountSettings'

type Section =
  | 'servers'
  | 'playback'
  | 'reading'
  | 'appearance'
  | 'connections'
  | 'account'
  | 'plan'
  | 'profile'

const NAV: { id: Section; icon: string; label: string }[] = [
  { id: 'servers', icon: 'dns', label: 'My servers' },
  { id: 'playback', icon: 'graphic_eq', label: 'Playback' },
  { id: 'reading', icon: 'menu_book', label: 'Reading' },
  { id: 'appearance', icon: 'palette', label: 'Appearance' },
  { id: 'connections', icon: 'hub', label: 'Connections' },
  { id: 'account', icon: 'person', label: 'Account' },
  { id: 'plan', icon: 'workspace_premium', label: 'Subscription' },
  { id: 'profile', icon: 'manage_accounts', label: 'Profile & sign-in' },
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
export function AccountPage() {
  const [section, setSection] = useState<Section>('servers')

  return (
    <div className="page config-wrap fade-in">
      <nav className="config-nav">
        <div className="cn-label">Account</div>
        {NAV.map((n) => (
          <button
            key={n.id}
            className={'cn-item' + (section === n.id ? ' on' : '')}
            onClick={() => setSection(n.id)}
          >
            <Icon name={n.icon} fill={section === n.id} />
            {n.label}
          </button>
        ))}
      </nav>
      <div className="config-body">
        {section === 'servers' && <MyServers />}
        {section === 'playback' && <PlaybackSettings />}
        {section === 'reading' && <ReadingSettings />}
        {section === 'appearance' && <AppearanceSettings />}
        {section === 'connections' && <ConnectionsSettings />}
        {section === 'account' && <AccountSettings />}
        {section === 'plan' && <Subscription />}
        {section === 'profile' && <Profile />}
      </div>
    </div>
  )
}

function MyServers() {
  const { data: servers, isLoading } = useServers()
  const { server: active } = useActiveServer()
  const [linkOpen, setLinkOpen] = useState(false)

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
            Link your HearthShelf server with the pairing code from its setup screen
            to reach your library from anywhere.
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

      {linkOpen && <LinkServerDialog onClose={() => setLinkOpen(false)} />}
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
              (isPro
                ? 'bg-primary/15 text-primary'
                : 'bg-secondary text-secondary-foreground')
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
      <Check
        size={16}
        className={on ? 'text-primary' : 'text-muted-foreground/40'}
      />
      <span className={on ? 'text-card-foreground' : 'text-muted-foreground'}>{children}</span>
    </li>
  )
}

function Profile() {
  return (
    <section>
      <div className="section-head">
        <Icon name="person" />
        <h2>Profile &amp; sign-in</h2>
      </div>
      {/* Clerk owns identity: email, password, security, connected accounts,
          active devices. Skinned to the dark shell via clerkAppearance. */}
      <UserProfile routing="hash" />
    </section>
  )
}
