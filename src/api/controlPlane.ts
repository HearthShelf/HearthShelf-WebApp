/**
 * Client for the HearthShelf control plane (the CF Worker).
 *
 * Every call carries the Clerk session token as a bearer (see authToken.ts).
 * The control plane answers "which servers am I linked to?", mints short-lived
 * grants for a chosen server, links a server via a pairing code, and unlinks.
 */
import { CONTROL_PLANE_URL } from '@/lib/config'
import { getAuthToken } from '@/lib/authToken'
import type { LinkedServer } from '@/types/server'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * Thrown when we held a token but the control plane rejected it (401) - i.e. the
 * session expired or was revoked mid-use. Distinct from "never signed in" so the
 * UI can react with a sign-out + message rather than a generic error toast.
 */
export class SessionExpiredError extends ApiError {
  constructor() {
    super(401, 'Your session expired - please sign in again')
  }
}

// The API layer must not import Clerk directly; the app registers what to do
// when a session expires (sign the user out + send them to /sign-in).
let onSessionExpired: (() => void) | null = null
export function setSessionExpiredHandler(fn: () => void): void {
  onSessionExpired = fn
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAuthToken()
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${CONTROL_PLANE_URL}${path}`, { ...init, headers })
  if (!res.ok) {
    // A 401 while we DID present a token means the session is no longer valid.
    if (res.status === 401 && token) {
      onSessionExpired?.()
      throw new SessionExpiredError()
    }
    let detail = res.statusText
    try {
      const body = (await res.json()) as { error?: string; detail?: string }
      detail = body.detail || body.error || detail
    } catch {
      // non-JSON error body; keep statusText
    }
    throw new ApiError(res.status, detail)
  }
  return res.json() as Promise<T>
}

interface ServersResponse {
  servers: Array<{ id: string; name: string; url: string; role: 'admin' | 'user' }>
}

/** List the servers the signed-in user has linked. */
export async function fetchLinkedServers(): Promise<LinkedServer[]> {
  const data = await request<ServersResponse>('/servers')
  // The control plane doesn't track live reachability; the per-server view
  // probes the server directly. Mark unknown until then.
  return data.servers.map((s) => ({ ...s, status: 'unknown' as const }))
}

interface GrantResponse {
  grant: string
  server: { id: string; url: string }
  expires_in: number
}

/** Mint a short-lived grant for one server (redeemed against the HS server). */
export async function mintGrant(serverId: string): Promise<GrantResponse> {
  return request<GrantResponse>(`/servers/${encodeURIComponent(serverId)}/grant`, {
    method: 'POST',
  })
}

export interface ServerStatusResponse {
  status: 'online' | 'offline'
  /** False when the stored public URL can never be reached from a browser. */
  reachable: boolean
  /** Why the URL is unreachable (when reachable === false). */
  reason?: string
  http_status?: number
  detail?: string
}

/** Live reachability of one linked server (control plane probes its health). */
export async function fetchServerStatus(serverId: string): Promise<ServerStatusResponse> {
  return request<ServerStatusResponse>(
    `/servers/${encodeURIComponent(serverId)}/status`
  )
}

interface RedeemResponse {
  ok: boolean
  server: { id: string; url: string; name: string | null }
}

/** Link a server to the signed-in user by redeeming a pairing code. */
export async function redeemPairingCode(
  code: string,
  displayName?: string
): Promise<RedeemResponse> {
  return request<RedeemResponse>('/pairing/redeem', {
    method: 'POST',
    body: JSON.stringify({ code, display_name: displayName }),
  })
}

/** Unlink a server from the signed-in user. */
export async function unlinkServer(serverId: string): Promise<void> {
  await request(`/servers/${encodeURIComponent(serverId)}`, { method: 'DELETE' })
}

interface InviteResponse {
  ok: boolean
  email: string
  role: 'admin' | 'user'
  emailed: boolean
}

/** Invite someone by email to a server (admin only). */
export async function inviteToServer(
  serverId: string,
  email: string,
  role: 'admin' | 'user' = 'user'
): Promise<InviteResponse> {
  return request<InviteResponse>(`/servers/${encodeURIComponent(serverId)}/invite`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  })
}
