/**
 * Per-session ABS access, with a deliberately short-lived token cache.
 *
 * A tool call needs a per-user ABS token for the target box. Getting one costs a
 * control-plane round trip plus a box round trip, so we cache it - but only in
 * the Durable Object's MEMORY and only for ABS_TOKEN_TTL_SECONDS (default 10
 * min).
 *
 * WHY MEMORY-ONLY AND SHORT: ARCHITECTURE.md principle 5 says secrets at rest
 * are a footprint to minimize. This is the first server-side component that
 * holds a per-user ABS credential at all, so it holds nothing durable: the cache
 * dies with the isolate, and anything in it could be re-obtained anyway by
 * anyone already holding the session context. Never persist these to KV or the
 * DO's SQLite.
 */
import type { Env, McpProps } from '../types'
import { connectToServer } from './controlPlane'

interface CachedToken {
  token: string
  serverUrl: string
  /** Epoch ms after which we re-mint rather than reuse. */
  expiresAt: number
}

/** Thrown when ABS itself rejects or fails a request. */
export class AbsError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export class AbsSession {
  private cache = new Map<string, CachedToken>()

  constructor(
    private env: Env,
    private props: McpProps,
  ) {}

  private ttlMs(): number {
    return Number(this.env.ABS_TOKEN_TTL_SECONDS || '600') * 1000
  }

  /** Get a valid ABS token for a server, connecting (or re-connecting) if needed. */
  private async token(serverId: string): Promise<CachedToken> {
    const hit = this.cache.get(serverId)
    if (hit && hit.expiresAt > Date.now()) return hit

    const { token, serverUrl } = await connectToServer(this.env, this.props, serverId)
    const entry: CachedToken = { token, serverUrl, expiresAt: Date.now() + this.ttlMs() }
    this.cache.set(serverId, entry)
    return entry
  }

  /**
   * Authenticated GET against a box. `path` is absolute from the origin, so it
   * serves both the ABS-native surface (`/api/...`) and HearthShelf's own
   * (`/hs/...`). Retries once on a 401 with a freshly minted token, since the
   * cached one may have been revoked before our TTL elapsed.
   */
  async get<T>(serverId: string, path: string): Promise<T> {
    let entry = await this.token(serverId)

    let res = await this.raw(entry, path)
    if (res.status === 401) {
      this.cache.delete(serverId)
      entry = await this.token(serverId)
      res = await this.raw(entry, path)
    }

    if (!res.ok) throw new AbsError(res.status, `abs_${res.status}`)
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  private raw(entry: CachedToken, path: string): Promise<Response> {
    return fetch(`${entry.serverUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${entry.token}`,
        Accept: 'application/json',
      },
    })
  }
}
