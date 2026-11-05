import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getJobs, runJobNow, cancelJob, getRunLogs, jobKeys, type JobSummary } from '@/api/absJobs'
import {
  JOB_STATUS_META,
  fmtJobDuration,
  fmtJobInterval,
  fmtJobWhen,
  type JobStatusTone,
} from '@hearthshelf/core'
import { useAdvancedMode } from '@/pages/config/AdvancedMode'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import type { AbsTarget } from '@/api/absLibrary'

const TONE_COLOR: Record<JobStatusTone, string> = {
  info: '#4f9db0',
  success: '#5a9c52',
  danger: '#d8443a',
}

function RunLogs({ target, runId }: { target: AbsTarget; runId: string }) {
  const { data } = useQuery({
    queryKey: jobKeys.logs(target.serverId, runId),
    queryFn: () => getRunLogs(target, runId),
    refetchInterval: 3000,
  })
  const logs = data?.logs ?? []
  if (!logs.length) return <div className="job-logs empty">No log lines yet.</div>
  return (
    <div className="job-logs log-box">
      {logs.map((l) => (
        <div className="log-line" key={l.seq}>
          <span style={{ color: 'var(--text-faint)' }}>
            {new Date(l.at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>{' '}
          {l.level !== 'info' && (
            <span style={{ color: l.level === 'error' ? '#d8443a' : '#d9a45a' }}>
              [{l.level.toUpperCase()}]
            </span>
          )}{' '}
          {l.message}
        </div>
      ))}
    </div>
  )
}

function JobCard({ target, job }: { target: AbsTarget; job: JobSummary }) {
  const qc = useQueryClient()
  const { advanced } = useAdvancedMode()
  const [showLogs, setShowLogs] = useState(false)
  const run = job.lastRun
  const running = job.running || run?.status === 'running'

  const trigger = useMutation({
    mutationFn: () => runJobNow(target, job.id),
    onSuccess: () => {
      setShowLogs(true)
      void qc.invalidateQueries({ queryKey: jobKeys.list(target.serverId) })
    },
  })

  const kill = useMutation({
    mutationFn: () => cancelJob(target, job.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: jobKeys.list(target.serverId) }),
  })

  const meta = run ? JOB_STATUS_META[run.status] : null
  const pct =
    running && run && run.itemsTotal > 0
      ? Math.round((run.itemsProcessed / run.itemsTotal) * 100)
      : null

  return (
    <div className="job-card">
      <div className="job-head">
        <div style={{ minWidth: 0 }}>
          <div className="job-name">{job.name}</div>
          <div className="job-desc">{job.description}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
          {advanced && running && (
            <button
              className="btn btn-danger"
              disabled={kill.isPending}
              onClick={() => kill.mutate()}
              title="Stop this running job"
            >
              <Icon name="stop_circle" fill />
              {kill.isPending ? 'Stopping...' : 'Kill'}
            </button>
          )}
          <button
            className="btn btn-primary"
            disabled={running || trigger.isPending}
            onClick={() => trigger.mutate()}
          >
            <Icon name={running ? 'hourglass_top' : 'play_arrow'} fill />
            {running ? 'Running...' : 'Run now'}
          </button>
        </div>
      </div>

      <div className="job-meta">
        <span>
          <Icon name="schedule" /> {fmtJobInterval(job.intervalMs)}
        </span>
        {run && meta && (
          <span style={{ color: TONE_COLOR[meta.tone] }}>
            <Icon name="circle" fill /> {meta.label}
          </span>
        )}
        <span style={{ color: 'var(--text-muted)' }}>
          Last run: {fmtJobWhen(run?.startedAt ?? null)}
        </span>
        {run?.finishedAt && (
          <span style={{ color: 'var(--text-faint)' }}>{fmtJobDuration(run)}</span>
        )}
        {pct != null && <span style={{ color: 'var(--text-muted)' }}>{pct}%</span>}
      </div>

      {run?.summary && run.status === 'ok' && <div className="job-summary">{run.summary}</div>}
      {run?.error && (
        <div className="rr-err" style={{ marginTop: 8 }}>
          <Icon name="error" fill /> {run.error}
        </div>
      )}

      {run && (
        <button className="job-logs-toggle" onClick={() => setShowLogs((v) => !v)}>
          <Icon name={showLogs ? 'expand_less' : 'expand_more'} /> {showLogs ? 'Hide' : 'View'} logs
        </button>
      )}
      {showLogs && run && <RunLogs target={target} runId={run.id} />}
    </div>
  )
}

export function ConfigJobs() {
  const { target } = useActiveServer()
  const { data, isLoading } = useQuery({
    queryKey: jobKeys.list(target?.serverId ?? ''),
    queryFn: () => getJobs(target!),
    enabled: Boolean(target),
    refetchInterval: 5000,
  })

  if (!target) return null

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Admin</div>
        <h1 className="title-xl">Tasks</h1>
        <p className="page-sub">
          Background jobs that keep your library data fresh. They run on a schedule; you can also
          run one now and watch its log.
        </p>
      </div>

      {isLoading ? (
        <LoadingSpinner className="py-12" label="Loading tasks..." />
      ) : (
        <div className="job-list">
          {(data?.jobs ?? []).map((job) => (
            <JobCard key={job.id} target={target} job={job} />
          ))}
        </div>
      )}
    </>
  )
}
