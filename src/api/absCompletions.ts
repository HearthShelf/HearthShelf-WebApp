/**
 * The caller's finished-books log, against the connected server's HearthShelf
 * backend (GET /hs/completions on the server's own origin, not ABS's /api/*).
 *
 * This is HearthShelf's own durable record, not derivable from ABS: ABS keeps a
 * single finishedAt per (user, book) that is overwritten on a re-finish, so it
 * can answer neither "when" reliably nor "how many times" at all.
 */
import { getAbsToken } from '@/lib/absTokens'
import type { AbsTarget } from './absLibrary'
import type { HSCompletion, HSCompletionsResponse } from '@hearthshelf/core'

export type Completion = HSCompletion
export type CompletionsPage = HSCompletionsResponse

export const COMPLETIONS_PAGE_SIZE = 25

export async function getCompletions(
  t: AbsTarget,
  limit = COMPLETIONS_PAGE_SIZE,
  offset = 0,
): Promise<CompletionsPage> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new Error('no token')
  const origin = t.serverUrl.replace(/\/$/, '')
  const res = await fetch(`${origin}/hs/completions?limit=${limit}&offset=${offset}`, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })
  if (!res.ok) throw new Error(`Completions ${res.status}`)
  return res.json() as Promise<CompletionsPage>
}
