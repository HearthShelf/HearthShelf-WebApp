import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Loader2,
  AlertTriangle,
  Trash2,
  Server,
  ChevronRight,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  ShieldX,
  Mail,
} from 'lucide-react'
import { fetchAdminServers, fetchAdminServer, deregisterServer, type AdminServer } from '@/api/controlPlane'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/cn'

const MS_PER_DAY = 86_400_000

/** Days until a cert's not_after, or null if there's no cert / no expiry known. */
function daysUntil(notAfter: number | null): number | null {
  if (notAfter == null) return null
  return Math.ceil((notAfter - Date.now()) / MS_PER_DAY)
}

type CertTier = 'active' | 'expiring' | 'failed' | 'none'

/** Bucket a server's cert into a tier for both the icon and the sort/filter
 *  controls. "expiring" fires inside 14 days so it surfaces before "failed"
 *  becomes the only signal an operator gets. */
function certTier(cert: AdminServer['cert']): CertTier {
  if (!cert) return 'none'
  if (cert.status === 'failed') return 'failed'
  if (cert.status !== 'active') return 'none'
  const days = daysUntil(cert.not_after)
  if (days != null && days <= 14) return 'expiring'
  return 'active'
}

type EmailTier = 'ok' | 'warn' | 'high' | 'over'

/** Bucket email-relay usage by percent of the monthly cap: green under 400,
 *  yellow 400-450 is arbitrary-threshold language from the ask, translated
 *  here to percent-of-cap so it still makes sense for any cap size. */
function emailTier({ sent_this_window, monthly_cap }: AdminServer['email_relay']): EmailTier {
  if (monthly_cap <= 0) return sent_this_window > 0 ? 'over' : 'ok'
  const pct = sent_this_window / monthly_cap
  if (pct >= 1) return 'over'
  if (pct >= 0.9) return 'high'
  if (pct >= 0.8) return 'warn'
  return 'ok'
}

const CERT_ICON: Record<CertTier, typeof ShieldCheck> = {
  active: ShieldCheck,
  expiring: ShieldAlert,
  failed: ShieldX,
  none: ShieldQuestion,
}

const CERT_COLOR: Record<CertTier, string> = {
  active: 'text-green-500',
  expiring: 'text-orange-500',
  failed: 'text-red-500',
  none: 'text-muted-foreground',
}

const CERT_LABEL: Record<CertTier, string> = {
  active: 'Active',
  expiring: 'Expiring soon',
  failed: 'Failed',
  none: 'No cert',
}

const EMAIL_COLOR: Record<EmailTier, string> = {
  ok: 'text-green-500',
  warn: 'text-yellow-500',
  high: 'text-orange-500',
  over: 'text-red-500',
}

type SortKey = 'name' | 'cert' | 'email'

const CERT_SORT_RANK: Record<CertTier, number> = { failed: 0, expiring: 1, none: 2, active: 3 }

/**
 * Fleet server roster + per-server inspect. Cards surface cert health and
 * email-relay usage at a glance (icon + color + days-remaining) so an operator
 * can triage without opening every row; filter/sort narrow the list to the
 * servers that need attention. Selecting a server still opens a detail panel
 * with the full breakdown - health signals only, no per-user data. Moderation
 * here is a hard-deregister (destructive, not reversible - the operator must
 * re-pair); the control plane audits it.
 */
export function AdminServersPage() {
  const [selected, setSelected] = useState<string | null>(null)
  const [certFilter, setCertFilter] = useState<'all' | CertTier>('all')
  const [emailFilter, setEmailFilter] = useState<'all' | EmailTier>('all')
  const [sortKey, setSortKey] = useState<SortKey>('cert')

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-servers'],
    queryFn: fetchAdminServers,
  })

  const filtered = useMemo(() => {
    if (!data) return []
    let rows = data
    if (certFilter !== 'all') rows = rows.filter((s) => certTier(s.cert) === certFilter)
    if (emailFilter !== 'all') rows = rows.filter((s) => emailTier(s.email_relay) === emailFilter)
    return [...rows].sort((a, b) => {
      if (sortKey === 'name') return (a.name || a.url).localeCompare(b.name || b.url)
      if (sortKey === 'cert') return CERT_SORT_RANK[certTier(a.cert)] - CERT_SORT_RANK[certTier(b.cert)]
      return b.email_relay.sent_this_window / (b.email_relay.monthly_cap || 1) -
        a.email_relay.sent_this_window / (a.email_relay.monthly_cap || 1)
    })
  }, [data, certFilter, emailFilter, sortKey])

  if (isLoading) {
    return (
      <Panel>
        <Loader2 className="animate-spin" size={18} />
        <span className="t-body">Loading servers...</span>
      </Panel>
    )
  }
  if (error) {
    return (
      <Panel>
        <AlertTriangle size={18} className="text-destructive" />
        <span className="t-body">
          Could not load servers: {error instanceof Error ? error.message : 'unknown error'}
        </span>
      </Panel>
    )
  }
  if (!data || data.length === 0) {
    return (
      <Panel>
        <span className="t-body text-muted-foreground">No servers are registered yet.</span>
      </Panel>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Cert"
          value={certFilter}
          onChange={setCertFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'expiring', label: 'Expiring soon' },
            { value: 'failed', label: 'Failed' },
            { value: 'none', label: 'No cert' },
          ]}
        />
        <FilterSelect
          label="Email"
          value={emailFilter}
          onChange={setEmailFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'ok', label: 'Normal' },
            { value: 'warn', label: '80-90% of cap' },
            { value: 'high', label: '90-100% of cap' },
            { value: 'over', label: 'At/over cap' },
          ]}
        />
        <FilterSelect
          label="Sort"
          value={sortKey}
          onChange={setSortKey}
          options={[
            { value: 'cert', label: 'Cert health' },
            { value: 'email', label: 'Email usage' },
            { value: 'name', label: 'Name' },
          ]}
        />
        <span className="t-muted ml-auto text-[12px]">
          {filtered.length} of {data.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <Panel>
          <span className="t-body text-muted-foreground">No servers match these filters.</span>
        </Panel>
      ) : (
        filtered.map((s) => (
          <ServerCard
            key={s.id}
            server={s}
            open={selected === s.id}
            onToggle={() => setSelected((cur) => (cur === s.id ? null : s.id))}
          />
        ))
      )}
    </div>
  )
}

function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <label className="flex items-center gap-1.5 text-[13px]">
      <span className="t-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-8 rounded-md border border-border bg-card px-2 text-[13px] text-card-foreground"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function ServerCard({
  server,
  open,
  onToggle,
}: {
  server: AdminServer
  open: boolean
  onToggle: () => void
}) {
  const cTier = certTier(server.cert)
  const CertIcon = CERT_ICON[cTier]
  const days = server.cert ? daysUntil(server.cert.not_after) : null
  const eTier = emailTier(server.email_relay)

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <Server size={15} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-card-foreground">
            {server.name || server.url}
          </span>
          <span className="t-mono block truncate text-[12px] text-muted-foreground">
            {server.id}
          </span>
        </span>

        <span
          className={cn('flex shrink-0 items-center gap-1 text-[12px]', CERT_COLOR[cTier])}
          title={`Cert: ${CERT_LABEL[cTier]}`}
        >
          <CertIcon size={15} />
          {days != null && <span>{days < 0 ? 'expired' : `${days}d`}</span>}
        </span>

        <span
          className={cn('flex shrink-0 items-center gap-1 text-[12px]', EMAIL_COLOR[eTier])}
          title={`Email relay: ${server.email_relay.sent_this_window} / ${server.email_relay.monthly_cap} this month`}
        >
          <Mail size={15} />
          <span>
            {server.email_relay.sent_this_window}/{server.email_relay.monthly_cap}
          </span>
        </span>

        <ChevronRight
          size={16}
          className={`shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {open && <ServerDetail serverId={server.id} />}
    </div>
  )
}

function ServerDetail({ serverId }: { serverId: string }) {
  const qc = useQueryClient()
  const [confirmDeregister, setConfirmDeregister] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-server', serverId],
    queryFn: () => fetchAdminServer(serverId),
  })

  const deregister = useMutation({
    mutationFn: () => deregisterServer(serverId),
    onSuccess: () => {
      notify.success('Server deregistered')
      setConfirmDeregister(false)
      void qc.invalidateQueries({ queryKey: ['admin-servers'] })
    },
    onError: (e) => notify.error(notify.fromError(e, 'Deregister failed')),
  })

  if (isLoading) {
    return (
      <div className="border-t border-border px-4 py-4 text-[13px] text-muted-foreground">
        <Loader2 className="inline animate-spin" size={14} /> Loading...
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="border-t border-border px-4 py-4 text-[13px] text-destructive">
        Could not load server detail.
      </div>
    )
  }

  return (
    <div className="border-t border-border px-4 py-4 text-[13px]">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="t-muted">URL</dt>
        <dd className="break-all text-card-foreground">{data.url}</dd>
        <dt className="t-muted">Cert</dt>
        <dd className="text-card-foreground">
          {data.cert
            ? `${data.cert.status}${data.cert.not_after ? ` (until ${new Date(data.cert.not_after).toLocaleDateString()})` : ''}`
            : 'none'}
        </dd>
        <dt className="t-muted">Email relay</dt>
        <dd className="text-card-foreground">
          {data.email_relay.sent_this_window} / {data.email_relay.monthly_cap} this month
        </dd>
      </dl>

      <div className="mt-4 flex justify-end">
        <Button variant="destructive" size="sm" onClick={() => setConfirmDeregister(true)}>
          <Trash2 size={14} />
          Deregister server
        </Button>
      </div>

      {confirmDeregister && (
        <ConfirmDialog
          title="Deregister this server?"
          message={
            <>
              This removes the server, all its user links, invites, OAuth client, and cert record.
              It cannot be undone - the operator would have to pair again from scratch.
            </>
          }
          confirmLabel="Deregister"
          busy={deregister.isPending}
          onConfirm={() => deregister.mutate()}
          onCancel={() => setConfirmDeregister(false)}
        />
      )}
    </div>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-muted-foreground">
      {children}
    </div>
  )
}
