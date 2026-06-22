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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAuthToken()
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${CONTROL_PLANE_URL}${path}`, { ...init, headers })
  if (!res.ok) {
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
