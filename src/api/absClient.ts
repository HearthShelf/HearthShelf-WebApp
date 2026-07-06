/**
 * Direct client for a server's ABS API (the data path).
 *
 * Once connected (connectServer.ts), the SPA talks STRAIGHT to the server's
 * public origin with its ABS-native token - the control plane and HS Node
 * backend are out of the loop. This is ABS's own /api/* surface, reached
 * cross-origin (the server sends CORS for app.hearthshelf.com in hosted mode).
 *
 * Tokens are short-lived; on a 401 we transparently re-run the OIDC bounce
 * (silent: the Clerk session is still valid) and retry the request once. Covers
 * and audio streams take the token as a ?token= query param because <img>/<audio>
 * can't set an Authorization header.
 */
import { getAbsToken, clearAbsToken } from '@/lib/absTokens'
import { connectServer } from '@/lib/connectServer'
import { isCarModeActive } from '@/hooks/useCarMode'
import type { ABSDeviceInfo } from '@hearthshelf/core'

export class AbsError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Thrown when we have no token and can't get one (caller should prompt connect). */
export class NotConnectedError extends Error {
  constructor() {
    super('not_connected')
  }
}

interface AbsTarget {
  serverId: string
  /** Public origin of the server (no trailing slash needed). */
  serverUrl: string
}

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

/**
 * Authenticated JSON GET against the server's ABS API. Path is the ABS-native
 * path, e.g. `/api/libraries`. Refreshes the token once on 401.
 */
export async function absGet<T>(t: AbsTarget, path: string): Promise<T> {
  return absRequest<T>(t, path, { method: 'GET' })
}

/**
 * Authenticated JSON PATCH (e.g. progress sync). Tolerates an empty/non-JSON
 * 200 body (ABS returns no body on a progress PATCH).
 */
export async function absPatch<T = unknown>(
  t: AbsTarget,
  path: string,
  body: unknown,
): Promise<T | null> {
  return absRequest<T | null>(t, path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * Authenticated JSON POST (e.g. batch item actions, collection/playlist writes).
 * Tolerates an empty/non-JSON 200 body (some ABS routes return nothing).
 */
export async function absPost<T = unknown>(
  t: AbsTarget,
  path: string,
  body?: unknown,
): Promise<T | null> {
  return absRequest<T | null>(t, path, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** Authenticated DELETE. Tolerates an empty 200 body. */
export async function absDelete<T = unknown>(t: AbsTarget, path: string): Promise<T | null> {
  return absRequest<T | null>(t, path, { method: 'DELETE' })
}

async function absRequest<T>(
  t: AbsTarget,
  path: string,
  init: RequestInit,
  isRetry = false,
): Promise<T> {
  let token = getAbsToken(t.serverId)
  if (!token) {
    // No token yet - establish one (will pop the OIDC flow). If the user has a
    // live Clerk session this completes silently after the first interaction.
    token = await connectServer(t.serverId, t.serverUrl)
  }

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('Accept', 'application/json')

  const res = await fetch(`${origin(t)}${path}`, { ...init, headers })

  if (res.status === 401 && !isRetry) {
    // Token expired/invalid: drop it, silently reconnect, retry once.
    clearAbsToken(t.serverId)
    await connectServer(t.serverId, t.serverUrl)
    return absRequest<T>(t, path, init, true)
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      detail = body.error || body.message || detail
    } catch {
      // non-JSON error
    }
    throw new AbsError(res.status, detail)
  }
  // Some endpoints (progress PATCH) return 200 with a non-JSON body like the
  // literal string "OK", others return nothing. Tolerate both.
  const text = await res.text()
  if (!text) return null as T
  try {
    return JSON.parse(text) as T
  } catch {
    return null as T
  }
}

/**
 * Tokenized URL for a cover image or audio stream (for <img>/<audio> src).
 * The token rides as a query param since media tags can't set headers. Returns
 * null when there's no token yet (caller should connect first).
 */
export function absMediaUrl(t: AbsTarget, path: string): string | null {
  const token = getAbsToken(t.serverId)
  if (!token) return null
  const sep = path.includes('?') ? '&' : '?'
  return `${origin(t)}${path}${sep}token=${encodeURIComponent(token)}`
}

/**
 * The deviceInfo to send when opening a play session. When the in-car web
 * player is active it tags itself so listening history can tell a couch session
 * apart from one driven from the car's touchscreen; otherwise it's the plain
 * web client. Resolved per-call because car mode can toggle within a session.
 */
export function playDeviceInfo(): ABSDeviceInfo & { clientVersion: string } {
  return isCarModeActive()
    ? { deviceId: 'hearthshelf-web-car', clientName: 'HearthShelf Web (Car)', clientVersion: '0.1.0' }
    : { deviceId: 'hearthshelf-web', clientName: 'HearthShelf', clientVersion: '0.1.0' }
}
