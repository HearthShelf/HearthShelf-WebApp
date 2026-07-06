import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, AlertTriangle, Trash2, Server, ChevronRight } from 'lucide-react'
import { fetchAdminServers, fetchAdminServer, deregisterServer, type AdminServer } from '@/api/controlPlane'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { notify } from '@/lib/notify'

/**
 * Fleet server roster + per-server inspect. Selecting a server opens a detail
 * panel with hs.direct cert status and email-relay usage - health signals only,
 * no per-user data. Moderation here is a hard-deregister (destructive, not
 * reversible - the operator must re-pair); the control plane audits it.
 */
export function AdminServersPage() {
  const [selected, setSelected] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-servers'],
    queryFn: fetchAdminServers,
  })

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
    <div className="grid gap-2">
      {data.map((s) => (
        <ServerCard
          key={s.id}
          server={s}
          open={selected === s.id}
          onToggle={() => setSelected((cur) => (cur === s.id ? null : s.id))}
        />
      ))}
    </div>
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
    onError: (e) => notify.error(e instanceof Error ? e.message : 'Deregister failed'),
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
