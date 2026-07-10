/**
 * In-memory per-server ABS access tokens.
 *
 * After the OIDC connect bounce (connectServer.ts), each server hands us an
 * ABS-native access token. We hold it in memory only - never localStorage - so a
 * stray script or XSS can't lift a long-lived credential, and it dies with the
 * tab. On expiry the connect flow silently re-runs (the Clerk session is still
 * valid), so there's nothing durable to persist. Keyed by server id.
 */

const tokens = new Map<string, string>()

// Listeners notified whenever a token is set/cleared. Lets data-sync hooks pull
// exactly when a server becomes connected, instead of racing the connect flow on
// first mount (the token is set asynchronously by connectServer, after the
// active server - and thus the sync hooks - have already mounted).
const listeners = new Set<(serverId: string) => void>()

export function getAbsToken(serverId: string): string | undefined {
  return tokens.get(serverId)
}

export function setAbsToken(serverId: string, token: string): void {
  tokens.set(serverId, token)
  for (const fn of listeners) fn(serverId)
}

export function clearAbsToken(serverId: string): void {
  tokens.delete(serverId)
  for (const fn of listeners) fn(serverId)
}

export function hasAbsToken(serverId: string): boolean {
  return tokens.has(serverId)
}

/** Subscribe to token set/clear events (fires with the affected serverId).
 *  Returns an unsubscribe fn. */
export function subscribeAbsTokens(fn: (serverId: string) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
