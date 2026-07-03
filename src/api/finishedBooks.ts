import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from '@/api/absLibrary'

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

async function fbFetch<T>(t: AbsTarget, path: string, options: RequestInit = {}): Promise<T> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no_token')
  const res = await fetch(`${origin(t)}/hs/finished-books${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error((body as { error?: string } | null)?.error ?? `finished_books_${res.status}`)
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const finishedBooksKeys = {
  list: (serverId: string) => ['finished-books', 'list', serverId] as const,
  hardcover: (serverId: string) => ['finished-books', 'hardcover', serverId] as const,
}

export interface MatchCandidate {
  libraryItemId: string
  title: string
  author: string
  score: number
}
export interface MatchRow {
  title: string
  author: string
  isbn: string | null
  status: 'auto' | 'ambiguous' | 'none'
  candidates: MatchCandidate[]
}
export interface ImportRow {
  title: string
  author: string | null
  isbn: string | null
  dateFinished: string | null
  rating: number | null
  libraryItemId: string | null
}
export interface HardcoverAccountStatus {
  connected: boolean
  username: string | null
  lastSyncAt: number | null
  lastSyncStatus: 'ok' | 'error' | null
  lastSyncError: string | null
}
export interface HardcoverSyncResult {
  synced: number
  notFound: string[]
  errors: { title: string; error: string }[]
}

export function matchRows(
  t: AbsTarget,
  libraryId: string,
  rows: { title: string; author: string; isbn: string | null }[],
): Promise<{ matches: MatchRow[] }> {
  return fbFetch(t, '/match', { method: 'POST', body: JSON.stringify({ libraryId, rows }) })
}
export function importRows(
  t: AbsTarget,
  rows: ImportRow[],
): Promise<{ inserted: number; updated: number }> {
  return fbFetch(t, '/import', { method: 'POST', body: JSON.stringify({ rows }) })
}
export function getHardcoverAccount(t: AbsTarget): Promise<HardcoverAccountStatus> {
  return fbFetch(t, '/hardcover')
}
export function connectHardcover(t: AbsTarget, token: string): Promise<HardcoverAccountStatus> {
  return fbFetch(t, '/hardcover', { method: 'PUT', body: JSON.stringify({ token }) })
}
export function disconnectHardcover(t: AbsTarget): Promise<void> {
  return fbFetch(t, '/hardcover', { method: 'DELETE' })
}
export function triggerHardcoverSync(t: AbsTarget): Promise<HardcoverSyncResult> {
  return fbFetch(t, '/hardcover/sync', { method: 'POST' })
}
