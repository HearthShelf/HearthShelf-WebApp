/**
 * Admin client for the connected server's Auto Queue debugger
 * (/hs/admin/queue-debug). Reached like absJobs.ts: the connected server's
 * origin + the per-server ABS bearer token. Admin-only server-side.
 *
 * Ported from the self-hosted UI's src/api/queueDebug.ts - the report SHAPE is
 * produced by the server and is identical on both surfaces, so only the
 * transport differs. Keep the interfaces below in step with that file.
 *
 * Failures THROW rather than degrading to empty: on a diagnostic surface,
 * silently showing "no problems" when the request failed is the one behaviour
 * it must never have.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from './absLibrary'
import type { AutoRulePref, QueueEntry } from '@hearthshelf/core'

export interface QueueDebugSource {
  ruleId: string
  ruleLabel: string
  result: 'included' | 'excluded' | 'matched' | 'not_candidate' | 'modifier'
  reason: string
  seriesId?: string
  seriesName?: string
  sourceIndex?: number
  clubs?: { id: string; name: string }[]
}

export interface QueueDebugRule {
  id: string
  label: string
  priority: number
  enabled: boolean
  added: number
  attempts: Array<{
    result: string
    reason: string
    seriesId?: string
    seriesName?: string
    sourceIndex?: number
    clubs?: { id: string; name: string }[]
  }>
}

export interface QueueDebugTarget {
  libraryItemId: string
  title: string | null
  author: string | null
  inVisibleLibrary: boolean
  existsOnServer?: boolean
  hiddenByPermissions?: boolean
  isCurrentItem: boolean
  isFinished: boolean
  dismissedItem: boolean
  included: boolean
  position: number | null
  winningRule: string | null
  progress: {
    progress: number
    currentTime: number
    duration: number
    isFinished: boolean
    lastUpdate: number
  } | null
  series: { id: string; name: string; dismissed: boolean; sequence: string | null }[]
  sources: QueueDebugSource[]
  rules: QueueDebugRule[]
  notes: string[]
}

export interface QueueParityDiff {
  kind: 'order' | 'field' | 'length'
  position: number | null
  libraryItemId: string | null
  field?: string
  detail: string
}

export interface QueueDebugReport {
  generatedAt: number
  user: { id: string; username: string; type: string }
  mode: string
  rules: AutoRulePref[]
  current: { id: string | null; source: string }
  stored: {
    items: QueueEntry[]
    manual: QueueEntry[]
    currentItemId: string | null
    updatedAt: number
  }
  inputs: {
    libraries: { id: string; name: string }[]
    libraryItems: number
    series: number
    progressRows: number
    clubs: Array<{
      id: string
      name: string
      books: Array<QueueEntry & { slot: string; sourceIndex: number }>
    }>
    clubBooks: number
    manualBooks: number
    dismissals: {
      items: { id: string; title: string | null }[]
      series: { id: string; title: string | null }[]
    }
    hiddenByPermissions: number
  }
  result: {
    parity: boolean
    /** Empty when parity holds. Otherwise the first few concrete differences
     *  between Core's output and the diagnostic mirror, so a mismatch names
     *  what diverged instead of only that something did. */
    parityDiff: QueueParityDiff[]
    sameOrder: boolean
    queue: Array<
      QueueEntry & {
        position: number
        winningRule: string | null
        sources: QueueDebugSource[]
        storedPosition: number
      }
    >
    storedOnly: QueueEntry[]
    computedOnly: QueueEntry[]
  }
  target: QueueDebugTarget | null
  warnings: string[]
}

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

export async function getQueueDebugReport(
  t: AbsTarget,
  userId: string,
  itemId?: string,
): Promise<QueueDebugReport> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('Not connected to this server.')
  const query = new URLSearchParams({ userId })
  if (itemId?.trim()) query.set('itemId', itemId.trim())
  const res = await fetch(`${origin(t)}/hs/admin/queue-debug?${query}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string; error?: string } | null
    if (res.status === 403) throw new Error('You need to be an admin on this server.')
    throw new Error(body?.detail ?? body?.error ?? `Queue debugger failed (${res.status})`)
  }
  return res.json() as Promise<QueueDebugReport>
}
