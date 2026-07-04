/**
 * Admin client for the connected server's HearthShelf backups + the .hsarchive
 * format (/hs/backups/*, /hs/archive/*). Reached like absJobs.ts: the connected
 * server's origin + its per-server ABS bearer token. Admin-only server-side.
 * Reads degrade to safe empties on failure.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from './absLibrary'
import type {
  HsBackupsResponse,
  HsBackupConfig,
  HsArchiveEstimate,
  ArchiveRestoreMode,
} from '@hearthshelf/core'

export const hsBackupKeys = {
  list: (serverId: string) => ['hs-backups', serverId] as const,
}

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

function authHeaders(t: AbsTarget): Record<string, string> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  return { Authorization: `Bearer ${token}` }
}

async function hsJson<T>(t: AbsTarget, path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${origin(t)}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...authHeaders(t),
      ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json())?.detail ?? ''
    } catch {
      /* ignore */
    }
    throw new Error(detail || `HS backups ${res.status}`)
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

// --- HS backups ---

export async function getHsBackups(t: AbsTarget): Promise<HsBackupsResponse | null> {
  try {
    return await hsJson<HsBackupsResponse>(t, '/hs/backups')
  } catch {
    return null // backend unreachable (e.g. an older box) - the section hides
  }
}

export function runHsBackup(t: AbsTarget): Promise<{ runId: string | null }> {
  return hsJson(t, '/hs/backups', { method: 'POST' })
}

export function setHsBackupConfig(
  t: AbsTarget,
  patch: Partial<Pick<HsBackupConfig, 'schedule' | 'keep' | 'offBoxPath'>>,
): Promise<{ config: HsBackupConfig }> {
  return hsJson(t, '/hs/backups/config', { method: 'PUT', body: JSON.stringify(patch) })
}

export function deleteHsBackup(t: AbsTarget, id: string): Promise<{ ok: boolean }> {
  return hsJson(t, `/hs/backups/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function downloadHsBackup(t: AbsTarget, id: string): Promise<Blob> {
  const res = await fetch(`${origin(t)}/hs/backups/${encodeURIComponent(id)}/download`, {
    headers: authHeaders(t),
  })
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  return res.blob()
}

export async function uploadHsBackup(t: AbsTarget, file: File): Promise<void> {
  const res = await fetch(`${origin(t)}/hs/backups/upload`, {
    method: 'POST',
    headers: { ...authHeaders(t), 'Content-Type': 'application/zip' },
    body: file,
  })
  if (!res.ok) throw new Error(`Upload failed (${res.status})`)
}

export interface HsRestoreResult {
  ok: boolean
  crossServer?: boolean
  escapeDir?: string
}

export function restoreHsBackup(t: AbsTarget, id: string): Promise<HsRestoreResult> {
  return hsJson(t, `/hs/backups/${encodeURIComponent(id)}/restore`, { method: 'POST' })
}

// --- .hsarchive ---

export async function getArchiveEstimate(t: AbsTarget): Promise<HsArchiveEstimate | null> {
  try {
    return await hsJson<HsArchiveEstimate>(t, '/hs/archive/estimate')
  } catch {
    return null
  }
}

export async function downloadArchive(t: AbsTarget): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${origin(t)}/hs/archive`, { method: 'POST', headers: authHeaders(t) })
  if (!res.ok) throw new Error(`Archive failed (${res.status})`)
  const disp = res.headers.get('Content-Disposition') || ''
  const match = disp.match(/filename="([^"]+)"/)
  return { blob: await res.blob(), filename: match ? match[1] : 'hearthshelf.hsarchive' }
}

export async function restoreArchive(
  t: AbsTarget,
  file: File,
  mode: ArchiveRestoreMode,
): Promise<HsRestoreResult> {
  const res = await fetch(`${origin(t)}/hs/archive/restore?mode=${encodeURIComponent(mode)}`, {
    method: 'POST',
    headers: { ...authHeaders(t), 'Content-Type': 'application/zip' },
    body: file,
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json())?.detail ?? ''
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Restore failed (${res.status})`)
  }
  return res.json()
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
