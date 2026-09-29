/**
 * Quick-start parts for very long single-file books (GET /hs/parts/:itemId on
 * the connected HearthShelf server). See lib/bookParts.ts for why they exist.
 *
 * Best-effort by design: an older server (404/405), a bare ABS server, a network
 * error, a slow reply or a malformed body all resolve to null, and the player
 * streams the original file exactly as before. A plain fetch (not absRequest)
 * so a failure here never triggers the silent reconnect flow.
 */
import { getAbsToken } from '@/lib/absTokens'
import { parseBookParts, type BookParts } from '@/lib/bookParts'
import type { AbsTarget } from './absLibrary'

// Long enough for the server to read a big file's index on first request,
// short enough that a stuck server can't hold playback hostage.
const PARTS_TIMEOUT_MS = 8000

/**
 * Ask the server to get one part ready in the background (`?prepare=<index>`),
 * without waiting. Parts are cut on first request; warming the one the listener
 * will resume in while the book page is open means pressing play doesn't wait
 * on it. Fire-and-forget: any failure is ignored.
 */
export function prepareBookPart(t: AbsTarget, itemId: string, index: number): void {
  const token = getAbsToken(t.serverId)
  if (!token) return
  void fetch(
    `${t.serverUrl.replace(/\/$/, '')}/hs/parts/${encodeURIComponent(itemId)}?prepare=${index}`,
    { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
  ).catch(() => {})
}

export async function getBookParts(t: AbsTarget, itemId: string): Promise<BookParts | null> {
  const token = getAbsToken(t.serverId)
  if (!token) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PARTS_TIMEOUT_MS)
  try {
    const res = await fetch(
      `${t.serverUrl.replace(/\/$/, '')}/hs/parts/${encodeURIComponent(itemId)}`,
      {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      },
    )
    if (!res.ok) return null
    return parseBookParts(await res.json())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
