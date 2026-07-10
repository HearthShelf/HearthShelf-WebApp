/**
 * Listening sessions recorded while the server was unreachable, waiting to reach
 * ABS (mirrors the mobile app's pendingProgress store).
 *
 * When a live sync fails (server down / connection dropped), the player banks the
 * unsynced listened-time + final position here, keyed by book. The newest record
 * per item wins; a session only grows within one listen. On reconnect (or a
 * manual Sync-now tap) flush() POSTs them to ABS's /api/session/local-all, which
 * ingests each as a real playback session - so an hour listened while the server
 * was unreachable shows up in recent listens and stats with the right
 * listened-time and date, not just a moved progress bar.
 *
 * Persisted to localStorage so a banked listen survives a tab close/reload and
 * still syncs the next time the server is reachable.
 *
 * A plain subscribe/snapshot store wired into React with useSyncExternalStore.
 */
import { syncLocalSessions, type LocalSession, type AbsTarget } from '@/api/absLibrary'

export interface PendingSessionState {
  byId: ReadonlyMap<string, LocalSession>
}

const STORE_KEY = 'hs.pendingSessions.v1'

let state: PendingSessionState = { byId: hydrate() }
const listeners = new Set<() => void>()

function hydrate(): Map<string, LocalSession> {
  const byId = new Map<string, LocalSession>()
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return byId
    const parsed = JSON.parse(raw) as { items?: LocalSession[] }
    for (const s of parsed.items ?? []) {
      if (s && typeof s.libraryItemId === 'string') byId.set(s.libraryItemId, s)
    }
  } catch {
    // start empty on a bad payload
  }
  return byId
}

function emit(byId: Map<string, LocalSession>): void {
  state = { byId }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ items: [...byId.values()] }))
  } catch {
    // storage full / disabled: keep the in-memory copy, still flushable this session
  }
  listeners.forEach((l) => l())
}

export function getPendingSessionState(): PendingSessionState {
  return state
}

export function subscribePendingSessions(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function pendingCount(): number {
  return state.byId.size
}

/**
 * Record (or update) the banked session for a book. Keyed by libraryItemId so a
 * single offline listen accumulates into one session record - the latest tick's
 * position and listened-time overwrite the earlier one.
 */
export function recordLocalSession(session: LocalSession): void {
  if (!session.libraryItemId || session.timeListening <= 0) return
  const byId = new Map(state.byId)
  byId.set(session.libraryItemId, session)
  emit(byId)
}

/**
 * Replay every banked session to ABS, clearing each on success and keeping it on
 * failure (so a partial network blip retries next time). No-op when there's
 * nothing pending. Safe to call repeatedly.
 *
 * Returns true when there was nothing to send OR everything sent, false when a
 * send was attempted and failed - so a manual retry (the sync sheet) can tell the
 * user whether their banked offline listens reached the server.
 */
export async function flushPendingProgress(t: AbsTarget): Promise<boolean> {
  const items = [...state.byId.values()]
  if (!items.length) return true

  try {
    await syncLocalSessions(t, items)
  } catch {
    // Leave everything pending; the next reconnect/retry pass sends it.
    return false
  }

  // All ingested in one call - clear the ids we just sent, guarding against any
  // re-recorded meanwhile with a newer updatedAt (a listen that continued while
  // the flush was in flight).
  const byId = new Map(state.byId)
  for (const sent of items) {
    const cur = byId.get(sent.libraryItemId)
    if (cur && cur.updatedAt <= sent.updatedAt) byId.delete(sent.libraryItemId)
  }
  emit(byId)
  return true
}
