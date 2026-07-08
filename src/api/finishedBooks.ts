import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from '@/api/absLibrary'
import type {
  HSMatchCandidate,
  HSFinishedBookMatch,
  HSFinishedBookImportRow,
  HSHardcoverAccount,
  HSHardcoverSyncResult,
} from '@hearthshelf/core'

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

// Canonical `/hs/finished-books/*` shapes now come from @hearthshelf/core;
// aliased to the module's historical local names so callers stay unchanged.
export type MatchCandidate = HSMatchCandidate
export type MatchRow = HSFinishedBookMatch
export type ImportRow = HSFinishedBookImportRow
export type HardcoverAccountStatus = HSHardcoverAccount
export type HardcoverSyncResult = HSHardcoverSyncResult

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
  backfillAbs = false,
): Promise<{ inserted: number; updated: number; absBackfilled?: number }> {
  return fbFetch(t, '/import', { method: 'POST', body: JSON.stringify({ rows, backfillAbs }) })
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
