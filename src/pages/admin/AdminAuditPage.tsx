import { useQuery } from '@tanstack/react-query'
import { Loader2, AlertTriangle, ScrollText } from 'lucide-react'
import { fetchAuditLog, type AuditEntry } from '@/api/controlPlane'

/**
 * The platform-admin audit trail: every moderation/plan/roster action, newest
 * first. Read-only - the control plane writes a row on each mutating admin call.
 */
const ACTION_LABEL: Record<string, string> = {
  deregister_server: 'Deregistered server',
  set_plan: 'Set plan',
  add_admin: 'Added admin',
  remove_admin: 'Removed admin',
}

export function AdminAuditPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () => fetchAuditLog(200),
    refetchInterval: 60_000,
  })

  if (isLoading) {
    return (
      <Panel>
        <Loader2 className="animate-spin" size={18} />
        <span className="t-body">Loading audit log...</span>
      </Panel>
    )
  }
  if (error) {
    return (
      <Panel>
        <AlertTriangle size={18} className="text-destructive" />
        <span className="t-body">
          Could not load audit log: {error instanceof Error ? error.message : 'unknown error'}
        </span>
      </Panel>
    )
  }
  if (!data || data.length === 0) {
    return (
      <Panel>
        <span className="t-body text-muted-foreground">No admin actions recorded yet.</span>
      </Panel>
    )
  }

  return (
    <ul className="grid gap-2">
      {data.map((entry) => (
        <AuditRow key={entry.id} entry={entry} />
      ))}
    </ul>
  )
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const label = ACTION_LABEL[entry.action] ?? entry.action
  return (
    <li className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <ScrollText size={15} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-card-foreground">{label}</span>
          {entry.target && (
            <span className="t-mono block truncate text-[12px] text-muted-foreground">
              {entry.target}
            </span>
          )}
        </span>
        <span className="t-mono shrink-0 text-right text-[12px] text-muted-foreground">
          {new Date(entry.created_at).toLocaleString()}
        </span>
      </div>
      <div className="t-muted mt-1 pl-[27px] text-[12px]">
        by <span className="t-mono">{entry.actor}</span>
        {entry.detail && entry.detail !== 'null' ? ` - ${formatDetail(entry.detail)}` : ''}
      </div>
    </li>
  )
}

function formatDetail(detail: string): string {
  try {
    const obj = JSON.parse(detail) as Record<string, unknown>
    return Object.entries(obj)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(', ')
  } catch {
    return detail
  }
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-muted-foreground">
      {children}
    </div>
  )
}
