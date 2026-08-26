/**
 * Admin-only diagnostics, exposed as MCP tools.
 *
 * These are the same read-only reports the Debugger section of the web UI
 * renders (Series Debugger, Auto Queue Debugger). They exist here because the
 * reports are large, structured, and mostly read by asking questions of them -
 * "which book fell out, and at which stage?" - which is exactly what a model is
 * good at and a table of 25 rows is not.
 *
 * TWO BOUNDARIES, both deliberate:
 *
 * 1. READ ONLY. The re-sweep write that the UI offers is NOT exposed here. This
 *    server's contract (see mcp.ts) is that nothing reachable from a tool can
 *    mutate a library, because book metadata is untrusted text flowing into a
 *    model's context. A diagnostic that repairs state would break that.
 *
 * 2. ADMIN ONLY. Every other tool on this server reads the CALLER'S OWN
 *    library. These read server-wide data, and the queue report is per-user -
 *    so they widen the surface from "my books" to "this box's books, and any
 *    user's queue". The check is the connected server's own (`/hs/admin/*`
 *    returns 403 for a non-admin token), which keeps one authority rather than
 *    a second opinion here that could drift from it.
 */
import type { AbsSession } from '../lib/absClient'
import { AbsError } from '../lib/absClient'

/** Turn the server's 403 into something a model can act on rather than retry. */
async function adminGet<T>(abs: AbsSession, serverId: string, path: string): Promise<T> {
  try {
    return await abs.get<T>(serverId, path)
  } catch (err) {
    if (err instanceof AbsError && err.status === 403) {
      throw new Error(
        'This diagnostic needs an admin account on that server. You are signed in ' +
          'as a regular user, so the report cannot be read.',
      )
    }
    if (err instanceof AbsError && err.status === 404) {
      throw new Error(
        'That server does not offer this diagnostic. It needs a HearthShelf ' +
          'server new enough to expose /hs/admin/series-debug.',
      )
    }
    throw err
  }
}

export interface SeriesPick {
  seriesId: string
  name: string
}

/** Every series in the library, for finding the id a report needs. */
export async function listDebugSeries(
  abs: AbsSession,
  serverId: string,
  query?: string,
): Promise<{ series: SeriesPick[]; total: number; truncated: boolean }> {
  const body = await adminGet<{ series: SeriesPick[] }>(
    abs,
    serverId,
    '/hs/admin/series-debug/list',
  )
  const all = body.series ?? []
  const q = query?.trim().toLowerCase()
  const matched = q ? all.filter((s) => s.name.toLowerCase().includes(q)) : all
  // A large library has thousands of series; a full dump would swamp the
  // model's context for no benefit. Narrow with `query` instead.
  const capped = matched.slice(0, 100)
  return { series: capped, total: matched.length, truncated: matched.length > capped.length }
}

/** The full series-matching report: resolution, roster filtering, per-book
 *  ownership verdicts with the reason each signal matched or was refused, and
 *  stored-vs-live drift. */
export async function getSeriesReport(
  abs: AbsSession,
  serverId: string,
  seriesId: string,
): Promise<unknown> {
  const query = new URLSearchParams({ seriesId })
  return adminGet(abs, serverId, `/hs/admin/series-debug?${query}`)
}

/** The Auto Queue report for one user: rule-by-rule, why each book is in (or
 *  out of) their up-next list. */
export async function getQueueReport(
  abs: AbsSession,
  serverId: string,
  userId: string,
  itemId?: string,
): Promise<unknown> {
  const query = new URLSearchParams({ userId })
  if (itemId?.trim()) query.set('itemId', itemId.trim())
  return adminGet(abs, serverId, `/hs/admin/queue-debug?${query}`)
}
