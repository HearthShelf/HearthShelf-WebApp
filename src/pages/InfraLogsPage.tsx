import { useState } from 'react'
import { Loader2, RefreshCw, AlertTriangle, ServerCog, Cloud, HardDrive } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { fetchInfraLogs, ApiError, type InfraLog, type LogQueryParams } from '@/api/controlPlane'

/**
 * Infra log viewer. Pulls warn/error logs from every source (VPS cert broker,
 * control plane, self-hosted boxes) into one filterable table. Rendered as a tab
 * inside the admin shell (AdminLayout), which provides the page chrome and the
 * platform-admin gate; this component is just the logs surface.
 */
type SourceFilter = '' | 'vps' | 'cp' | 'box'
type SeverityFilter = '' | 'warn' | 'error'

const SOURCE_META: Record<string, { label: string; icon: typeof Cloud }> = {
  vps: { label: 'Cert broker (VPS)', icon: ServerCog },
  cp: { label: 'Control plane', icon: Cloud },
  box: { label: 'Self-hosted box', icon: HardDrive },
}

export function InfraLogsPage() {
  const [source, setSource] = useState<SourceFilter>('')
  const [severity, setSeverity] = useState<SeverityFilter>('')
  const [serverId, setServerId] = useState('')

  const params: LogQueryParams = { limit: 200 }
  if (source) params.source = source
  if (severity) params.severity = severity
  if (serverId.trim()) params.server_id = serverId.trim()

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['infra-logs', source, severity, serverId.trim()],
    queryFn: () => fetchInfraLogs(params),
    refetchInterval: 30_000,
    retry: (count, e) => !(e instanceof ApiError && (e.status === 403 || e.status === 401)) && count < 2,
  })

  const forbidden = error instanceof ApiError && error.status === 403
  const unavailable = error instanceof ApiError && error.status === 503

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <p className="t-muted text-[13px]">
          Warnings and errors from the cert broker, control plane, and linked
          servers. Newest first; auto-refreshes. Retained 30 days.
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="t-muted inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {forbidden ? (
        <Panel>
          <AlertTriangle size={18} className="text-muted-foreground" />
          <span className="t-body">
            This view is limited to platform admins. Your account isn&apos;t on the admin
            roster.
          </span>
        </Panel>
      ) : (
        <>
          {/* Filters */}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Select
              label="Source"
              value={source}
              onChange={(v) => setSource(v as SourceFilter)}
              options={[
                { value: '', label: 'All sources' },
                { value: 'vps', label: 'Cert broker' },
                { value: 'cp', label: 'Control plane' },
                { value: 'box', label: 'Self-hosted box' },
              ]}
            />
            <Select
              label="Severity"
              value={severity}
              onChange={(v) => setSeverity(v as SeverityFilter)}
              options={[
                { value: '', label: 'Warn + error' },
                { value: 'error', label: 'Errors only' },
                { value: 'warn', label: 'Warnings only' },
              ]}
            />
            <input
              type="text"
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              placeholder="Filter by server id"
              className="t-body rounded-md border border-border bg-card px-3 py-1.5 text-[13px] placeholder:text-muted-foreground"
            />
          </div>

          <div className="mt-4">
            {isLoading ? (
              <Panel>
                <Loader2 className="animate-spin" size={18} />
                <span className="t-body">Loading logs...</span>
              </Panel>
            ) : unavailable ? (
              <Panel>
                <AlertTriangle size={18} className="text-muted-foreground" />
                <span className="t-body">The log collector is unavailable right now.</span>
              </Panel>
            ) : error ? (
              <Panel>
                <AlertTriangle size={18} className="text-destructive" />
                <span className="t-body">
                  Could not load logs: {error instanceof Error ? error.message : 'unknown error'}
                </span>
              </Panel>
            ) : !data || data.length === 0 ? (
              <Panel>
                <span className="t-body text-muted-foreground">
                  No matching logs. Quiet infrastructure is good infrastructure.
                </span>
              </Panel>
            ) : (
              <ul className="grid gap-2">
                {data.map((log) => (
                  <LogRow key={log.id} log={log} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function LogRow({ log }: { log: InfraLog }) {
  const [open, setOpen] = useState(false)
  const meta = SOURCE_META[log.source] ?? { label: log.source, icon: Cloud }
  const Icon = meta.icon
  const isError = log.severity === 'error'
  return (
    <li className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span
          className={`inline-flex size-2 shrink-0 rounded-full ${isError ? 'bg-destructive' : 'bg-amber-500'}`}
          title={log.severity}
        />
        <Icon size={15} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-card-foreground">{log.event}</span>
          {log.message && <span className="t-muted block truncate text-[13px]">{log.message}</span>}
        </span>
        <span className="t-mono shrink-0 text-right text-[12px] text-muted-foreground">
          {new Date(log.ts).toLocaleString()}
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3 text-[13px]">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="t-muted">Source</dt>
            <dd className="text-card-foreground">{meta.label}</dd>
            {log.server_id && (
              <>
                <dt className="t-muted">Server</dt>
                <dd className="t-mono break-all">{log.server_id}</dd>
              </>
            )}
            {log.ip && (
              <>
                <dt className="t-muted">Source IP</dt>
                <dd className="t-mono">{log.ip}</dd>
              </>
            )}
          </dl>
          {log.detail && (
            <pre className="t-mono mt-3 max-h-64 overflow-auto rounded-md bg-secondary p-3 text-[12px] whitespace-pre-wrap break-all">
              {formatDetail(log.detail)}
            </pre>
          )}
        </div>
      )}
    </li>
  )
}

function formatDetail(detail: string): string {
  try {
    return JSON.stringify(JSON.parse(detail), null, 2)
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

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="inline-flex items-center gap-2">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="t-body rounded-md border border-border bg-card px-3 py-1.5 text-[13px]"
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
