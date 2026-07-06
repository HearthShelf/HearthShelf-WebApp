import { useState } from 'react'
import {
  Loader2,
  RefreshCw,
  AlertTriangle,
  ServerCog,
  Cloud,
  HardDrive,
  Smartphone,
  Trash2,
  Download,
  Copy,
  Check,
  ClipboardCopy,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchInfraLogs,
  deleteInfraLog,
  clearInfraLogs,
  ApiError,
  type InfraLog,
  type LogQueryParams,
} from '@/api/controlPlane'

/**
 * Infra log viewer. Pulls warn/error logs from every source (VPS cert broker,
 * control plane, self-hosted boxes, the phone app) into one filterable table.
 * Rendered as a tab inside the admin shell (AdminLayout), which provides the
 * page chrome and the platform-admin gate; this component is just the surface.
 */
type SourceFilter = '' | 'vps' | 'cp' | 'box' | 'mobile'
type SeverityFilter = '' | 'warn' | 'error'

const SOURCE_META: Record<string, { label: string; icon: typeof Cloud }> = {
  vps: { label: 'Cert broker (VPS)', icon: ServerCog },
  cp: { label: 'Control plane', icon: Cloud },
  box: { label: 'Self-hosted box', icon: HardDrive },
  mobile: { label: 'Phone app', icon: Smartphone },
}

export function InfraLogsPage() {
  const [source, setSource] = useState<SourceFilter>('')
  const [severity, setSeverity] = useState<SeverityFilter>('')
  const [serverId, setServerId] = useState('')
  const queryClient = useQueryClient()

  const params: LogQueryParams = { limit: 200 }
  if (source) params.source = source
  if (severity) params.severity = severity
  if (serverId.trim()) params.server_id = serverId.trim()

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['infra-logs', source, severity, serverId.trim()],
    queryFn: () => fetchInfraLogs(params),
    refetchInterval: 30_000,
    retry: (count, e) =>
      !(e instanceof ApiError && (e.status === 403 || e.status === 401)) && count < 2,
  })

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['infra-logs'] })

  const deleteOne = useMutation({
    mutationFn: (id: number) => deleteInfraLog(id),
    onSuccess: invalidate,
  })

  const clearAll = useMutation({
    mutationFn: () =>
      clearInfraLogs({
        ...(source ? { source } : {}),
        ...(severity ? { severity } : {}),
        ...(serverId.trim() ? { server_id: serverId.trim() } : {}),
      }),
    onSuccess: invalidate,
  })

  const forbidden = error instanceof ApiError && error.status === 403
  const unavailable = error instanceof ApiError && error.status === 503
  const hasFilter = !!(source || severity || serverId.trim())
  const rowCount = data?.length ?? 0

  function handleClear() {
    const scope = hasFilter ? 'the logs matching your current filters' : 'ALL logs'
    if (!window.confirm(`Delete ${scope}? This cannot be undone.`)) return
    clearAll.mutate()
  }

  function handleDownload() {
    if (!data || data.length === 0) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    a.download = `hearthshelf-logs-${source || 'all'}-${stamp}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <p className="t-muted text-[13px]">
          Warnings and errors from the cert broker, control plane, linked servers, and the phone
          app. Newest first; auto-refreshes. Retained 30 days.
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
            This view is limited to platform admins. Your account isn&apos;t on the admin roster.
          </span>
        </Panel>
      ) : (
        <>
          {/* Filters + bulk actions */}
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
                { value: 'mobile', label: 'Phone app' },
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

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownload}
                disabled={rowCount === 0}
                className="t-muted inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] hover:text-foreground disabled:opacity-50"
              >
                <Download size={14} />
                Download
              </button>
              <button
                type="button"
                onClick={handleClear}
                disabled={rowCount === 0 || clearAll.isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-[13px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                {clearAll.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                {hasFilter ? 'Clear filtered' : 'Clear all'}
              </button>
            </div>
          </div>

          {clearAll.isError && (
            <p className="mt-2 text-[12px] text-destructive">
              Could not clear logs:{' '}
              {clearAll.error instanceof Error ? clearAll.error.message : 'unknown error'}
            </p>
          )}

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
              <ul className="grid grid-cols-1 gap-2">
                {data.map((log) => (
                  <LogRow
                    key={log.id}
                    log={log}
                    onDelete={() => deleteOne.mutate(log.id)}
                    deleting={deleteOne.isPending && deleteOne.variables === log.id}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function LogRow({
  log,
  onDelete,
  deleting,
}: {
  log: InfraLog
  onDelete: () => void
  deleting: boolean
}) {
  const [open, setOpen] = useState(false)
  const meta = SOURCE_META[log.source] ?? { label: log.source, icon: Cloud }
  const Icon = meta.icon
  const isError = log.severity === 'error'
  return (
    <li className="min-w-0 rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span
            className={`inline-flex size-2 shrink-0 rounded-full ${isError ? 'bg-destructive' : 'bg-amber-500'}`}
            title={log.severity}
          />
          <Icon size={15} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-card-foreground">{log.event}</span>
            {log.message && (
              <span className="t-muted block truncate text-[13px]">{log.message}</span>
            )}
          </span>
          <span className="t-mono shrink-0 text-right text-[12px] text-muted-foreground">
            {new Date(log.ts).toLocaleString()}
          </span>
        </button>
        <CopyReportButton log={log} meta={meta} />
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          title="Delete this entry"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      </div>
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
          {/* Full message - the collapsed row truncates it, so show it whole and
              copyable here. Long D1/stack errors are only readable this way. */}
          {log.message && (
            <Block label="Message" text={log.message}>
              <p className="t-mono text-[12px] break-all whitespace-pre-wrap">{log.message}</p>
            </Block>
          )}
          {log.detail && (
            <Block label="Detail" text={formatDetail(log.detail)}>
              <pre className="t-mono max-h-64 overflow-auto rounded-md bg-secondary p-3 text-[12px] break-all whitespace-pre-wrap">
                {formatDetail(log.detail)}
              </pre>
            </Block>
          )}
        </div>
      )}
    </li>
  )
}

/** A labelled block with a copy-to-clipboard button (for message + detail). */
function Block({
  label,
  text,
  children,
}: {
  label: string
  text: string
  children: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)
  function copy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="t-muted text-[11px] tracking-wide uppercase">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="t-muted inline-flex items-center gap-1 text-[11px] hover:text-foreground"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {children}
    </div>
  )
}

function formatDetail(detail: string): string {
  try {
    return JSON.stringify(JSON.parse(detail), null, 2)
  } catch {
    return detail
  }
}

function formatLogAsMarkdown(log: InfraLog, sourceLabel: string): string {
  const lines = [
    `## ${log.event}`,
    '',
    `- **Severity:** ${log.severity}`,
    `- **Source:** ${sourceLabel}`,
    `- **Time:** ${new Date(log.ts).toLocaleString()}`,
  ]
  if (log.server_id) lines.push(`- **Server:** ${log.server_id}`)
  if (log.ip) lines.push(`- **Source IP:** ${log.ip}`)
  if (log.message) lines.push('', '**Message:**', '```', log.message, '```')
  if (log.detail) lines.push('', '**Detail:**', '```json', formatDetail(log.detail), '```')
  return lines.join('\n')
}

/** Copies the whole log entry as Claude-Code-friendly markdown (event, message, detail). */
function CopyReportButton({
  log,
  meta,
}: {
  log: InfraLog
  meta: { label: string; icon: typeof Cloud }
}) {
  const [copied, setCopied] = useState(false)
  function copy(e: React.MouseEvent) {
    e.stopPropagation()
    void navigator.clipboard.writeText(formatLogAsMarkdown(log, meta.label)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy report as markdown"
      className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
    >
      {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
    </button>
  )
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
