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

export function getAbsToken(serverId: string): string | undefined {
  return tokens.get(serverId)
}

export function setAbsToken(serverId: string, token: string): void {
  tokens.set(serverId, token)
}

export function clearAbsToken(serverId: string): void {
  tokens.delete(serverId)
}

export function hasAbsToken(serverId: string): boolean {
  return tokens.has(serverId)
}
