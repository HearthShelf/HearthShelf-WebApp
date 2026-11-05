/**
 * Admin client for the connected server's scheduled-jobs system (/hs/jobs/*).
 * Reached like absRequests.ts: the connected server's origin + the per-server ABS
 * bearer token. All endpoints are admin-only server-side. Reads degrade to empty
 * on failure; writes return a safe result.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from './absLibrary'
import type { JobRun, JobSummary, JobLogLine } from '@hearthshelf/core'

export type { JobRun, JobSummary, JobLogLine }

export const jobKeys = {
  list: (serverId: string) => ['jobs', 'list', serverId] as const,
  logs: (serverId: string, runId: string) => ['jobs', 'logs', serverId, runId] as const,
}

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

async function jobsFetch<T>(t: AbsTarget, path: string, options: RequestInit = {}): Promise<T> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const res = await fetch(`${origin(t)}/hs/jobs${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  if (!res.ok) throw new Error(`Jobs ${res.status}`)
  return res.json() as Promise<T>
}

export async function getJobs(t: AbsTarget): Promise<{ jobs: JobSummary[] }> {
  try {
    return await jobsFetch(t, '')
  } catch {
    return { jobs: [] }
  }
}

export async function runJobNow(t: AbsTarget, id: string): Promise<{ runId: string | null }> {
  try {
    return await jobsFetch(t, `/${encodeURIComponent(id)}/run`, { method: 'POST' })
  } catch {
    return { runId: null }
  }
}

export async function cancelJob(t: AbsTarget, id: string): Promise<{ runId: string | null }> {
  try {
    return await jobsFetch(t, `/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
  } catch {
    return { runId: null }
  }
}

export async function getRunLogs(t: AbsTarget, runId: string): Promise<{ logs: JobLogLine[] }> {
  try {
    return await jobsFetch(t, `/runs/${encodeURIComponent(runId)}/logs`)
  } catch {
    return { logs: [] }
  }
}
