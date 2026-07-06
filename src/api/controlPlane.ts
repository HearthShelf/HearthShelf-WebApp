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
  servers: Array<{
    id: string
    name: string
    url: string
    role: 'admin' | 'user'
    is_default?: boolean
  }>
}

/** List the servers the signed-in user has linked. */
export async function fetchLinkedServers(): Promise<LinkedServer[]> {
  const data = await request<ServersResponse>('/servers')
  // The control plane doesn't track live reachability; the per-server view
  // probes the server directly. Mark unknown until then.
  return data.servers.map((s) => ({
    id: s.id,
    name: s.name,
    url: s.url,
    role: s.role,
    status: 'unknown' as const,
    ...(s.is_default ? { isDefault: true } : {}),
  }))
}

/** Set this server as the user's default (a fresh device auto-connects here). */
export async function setDefaultServer(serverId: string): Promise<void> {
  await request(`/servers/${encodeURIComponent(serverId)}/default`, { method: 'POST' })
}

/** Clear the user's default server (fresh devices return to the picker). */
export async function clearDefaultServer(serverId: string): Promise<void> {
  await request(`/servers/${encodeURIComponent(serverId)}/default`, { method: 'DELETE' })
}

export type UpdateSeverity = 'info' | 'recommended' | 'security' | 'critical'

export interface LatestRelease {
  version: string
  severity: UpdateSeverity
  notes_url: string | null
  published_at: number | null
  /** A box below this version is treated as force-update (sticky prompt). */
  min_supported: string | null
}

/**
 * The newest HearthShelf release the control plane knows about (cached from
 * GitHub Releases). Public - no auth - so it works even before sign-in and from
 * the marketing site. Returns null when the cache is empty (no releases yet).
 */
export async function getLatestRelease(): Promise<LatestRelease | null> {
  const res = await fetch(`${CONTROL_PLANE_URL}/releases/latest`)
  if (!res.ok) return null
  const data = (await res.json()) as { release: LatestRelease | null }
  return data.release
}

export type Plan = 'free' | 'pro'

/** The signed-in user's plan/entitlement (D1 is the sole source of truth). */
export async function fetchMyPlan(): Promise<Plan> {
  const data = await request<{ plan: Plan }>('/me/plan')
  return data.plan
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
  return request<ServerStatusResponse>(`/servers/${encodeURIComponent(serverId)}/status`)
}

interface RedeemResponse {
  ok: boolean
  server: { id: string; url: string; name: string | null }
}

/** Link a server to the signed-in user by redeeming a pairing code. */
export async function redeemPairingCode(
  code: string,
  displayName?: string,
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

interface ResetSecretResponse {
  ok: boolean
  server_id: string
  server_secret: string
}

/**
 * Rotate this server's connection secret in place (owner-admin only). Returns the
 * new secret ONCE - the operator pastes it into the box's "recover connection"
 * field. Recovery hatch for a box that lost/desynced its stored secret; links,
 * invites, and certs survive (unlike deregister + re-pair).
 */
export async function resetServerSecret(serverId: string): Promise<ResetSecretResponse> {
  return request<ResetSecretResponse>(`/servers/${encodeURIComponent(serverId)}/reset-secret`, {
    method: 'POST',
  })
}

interface InviteResponse {
  ok: boolean
  email: string
  role: 'admin' | 'user'
  emailed: boolean
}

export type LogSource = 'vps' | 'cp' | 'box' | 'mobile'

export interface InfraLog {
  id: number
  ts: number
  source: LogSource
  severity: 'warn' | 'error'
  event: string
  server_id: string | null
  message: string | null
  detail: string | null
  ip: string | null
}

export interface LogQueryParams {
  source?: LogSource
  severity?: 'warn' | 'error'
  server_id?: string
  /** Only logs at or after this Unix-ms time. */
  since?: number
  /** Keyset paging: only logs older than this id. */
  before_id?: number
  limit?: number
}

/**
 * Fetch infra logs (platform operators only). The control plane proxies to the
 * isolated log collector. Throws ApiError(403) for non-operators so the page can
 * show a clean "not authorized" state; ApiError(503) when the collector is down.
 */
export async function fetchInfraLogs(params: LogQueryParams = {}): Promise<InfraLog[]> {
  const q = new URLSearchParams()
  if (params.source) q.set('source', params.source)
  if (params.severity) q.set('severity', params.severity)
  if (params.server_id) q.set('server_id', params.server_id)
  if (params.since) q.set('since', String(params.since))
  if (params.before_id) q.set('before_id', String(params.before_id))
  if (params.limit) q.set('limit', String(params.limit))
  const qs = q.toString()
  const data = await request<{ logs: InfraLog[] }>(`/logs${qs ? `?${qs}` : ''}`)
  return data.logs
}

/** Delete a single log row by id (platform operators only). */
export async function deleteInfraLog(id: number): Promise<{ deleted: number }> {
  return request<{ deleted: number }>(`/logs/${id}`, { method: 'DELETE' })
}

/**
 * Bulk-delete logs, honoring the same filters as the viewer so "Clear" removes
 * exactly the rows on screen. With no filters, clears the entire log table.
 */
export async function clearInfraLogs(
  filters: Pick<LogQueryParams, 'source' | 'severity' | 'server_id'> = {},
): Promise<{ deleted: number }> {
  const q = new URLSearchParams()
  if (filters.source) q.set('source', filters.source)
  if (filters.severity) q.set('severity', filters.severity)
  if (filters.server_id) q.set('server_id', filters.server_id)
  const qs = q.toString()
  return request<{ deleted: number }>(`/logs${qs ? `?${qs}` : ''}`, { method: 'DELETE' })
}

// --- platform admin -------------------------------------------------------
//
// The control plane gates all of these to the platform_admins D1 table (the same
// roster that gates the infra log viewer). Non-admins get ApiError(403) so a page
// can show a clean "not authorized" state; an absent/expired session is 401.

export interface AdminMe {
  clerk_user_id: string
  email: string
  role: string
}

/** Resolve whether the signed-in user is a platform admin (and their role). The
 *  control plane is the real gate; this just drives UI routing. Throws
 *  ApiError(403) when authenticated but not an admin. */
export async function fetchAdminMe(): Promise<AdminMe> {
  return request<AdminMe>('/admin/me')
}

export interface AdminServer {
  id: string
  name: string | null
  url: string
  link_count: number
  created_at: number
  last_seen_at: number | null
}

export async function fetchAdminServers(): Promise<AdminServer[]> {
  const data = await request<{ servers: AdminServer[] }>('/admin/servers')
  return data.servers
}

export interface AdminServerDetail {
  id: string
  name: string | null
  url: string
  created_at: number
  last_seen_at: number | null
  cert: { status: string; not_after: number | null; hash: string } | null
  email_relay: { sent_this_window: number; monthly_cap: number }
  links: Array<{ clerk_user_id: string; email: string; role: 'admin' | 'user'; created_at: number }>
}

export async function fetchAdminServer(serverId: string): Promise<AdminServerDetail> {
  return request<AdminServerDetail>(`/admin/servers/${encodeURIComponent(serverId)}`)
}

/** Hard-deregister a server (destructive, not reversible). Audited server-side. */
export async function deregisterServer(serverId: string): Promise<void> {
  await request(`/admin/servers/${encodeURIComponent(serverId)}`, { method: 'DELETE' })
}

export interface AdminUser {
  clerk_user_id: string
  plan: 'free' | 'pro'
  plan_source: string | null
  links: Array<{ server_id: string; email: string; role: 'admin' | 'user'; created_at: number }>
}

export async function fetchAdminUser(clerkUserId: string): Promise<AdminUser> {
  return request<AdminUser>(`/admin/users/${encodeURIComponent(clerkUserId)}`)
}

/** Manually set a user's plan (the only entitlement lever until billing lands). */
export async function setUserPlan(clerkUserId: string, plan: 'free' | 'pro'): Promise<void> {
  await request('/admin/entitlements', {
    method: 'POST',
    body: JSON.stringify({ clerk_user_id: clerkUserId, plan }),
  })
}

export interface PlatformAdminEntry {
  clerk_user_id: string
  email: string | null
  role: string
  granted_by: string | null
  granted_at: number
}

export async function fetchPlatformAdmins(): Promise<PlatformAdminEntry[]> {
  const data = await request<{ admins: PlatformAdminEntry[] }>('/admin/admins')
  return data.admins
}

export async function addPlatformAdmin(input: {
  email?: string
  clerk_user_id?: string
  role?: 'admin' | 'support'
}): Promise<void> {
  await request('/admin/admins', { method: 'POST', body: JSON.stringify(input) })
}

export async function removePlatformAdmin(clerkUserId: string): Promise<void> {
  await request(`/admin/admins/${encodeURIComponent(clerkUserId)}`, { method: 'DELETE' })
}

export interface AuditEntry {
  id: string
  actor: string
  action: string
  target: string | null
  detail: string | null
  created_at: number
}

export async function fetchAuditLog(limit = 100): Promise<AuditEntry[]> {
  const data = await request<{ audit: AuditEntry[] }>(`/admin/audit?limit=${limit}`)
  return data.audit
}

/** Invite someone by email to a server (admin only). */
export async function inviteToServer(
  serverId: string,
  email: string,
  role: 'admin' | 'user' = 'user',
): Promise<InviteResponse> {
  return request<InviteResponse>(`/servers/${encodeURIComponent(serverId)}/invite`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  })
}

// --- account switcher (device-remembered accounts) -------------------------

interface RememberResponse {
  handle: string
  label: string
  has_pin: boolean
}

/** Remember the CURRENT signed-in user on this device; returns the opaque handle
 *  to store. An optional 4-digit PIN gates future switches into this account. */
export async function rememberCurrentUser(opts?: {
  pin?: string
  label?: string
  imageUrl?: string
}): Promise<RememberResponse> {
  return request<RememberResponse>('/accounts/remember', {
    method: 'POST',
    body: JSON.stringify({ pin: opts?.pin, label: opts?.label, image_url: opts?.imageUrl }),
  })
}

interface SwitchTicketResponse {
  ticket: string
  expires_in: number
}

/**
 * Mint a single-use Clerk sign-in ticket for a remembered handle. Throws
 * ApiError on failure - callers should special-case:
 *   403 pin_required  -> wrong/missing PIN (body carries attempts_left)
 *   410 locked_out    -> too many wrong PINs; handle deleted, force re-login
 *   404 unknown_handle-> revoked/expired; prune from the roster
 */
export async function requestSwitchTicket(
  handle: string,
  pin?: string,
): Promise<SwitchTicketResponse> {
  return request<SwitchTicketResponse>('/accounts/switch-token', {
    method: 'POST',
    body: JSON.stringify({ handle, pin }),
  })
}

/**
 * Forget a remembered account on this device (server-side revoke). If the
 * handle has a PIN, it must be passed unless `confirmForgot` is set - which is
 * the "I forgot my PIN" escape hatch and skips the PIN check entirely. The
 * caller must have already shown an explicit confirmation before setting it;
 * this only removes the local handle, it never signs the account out elsewhere.
 * Throws ApiError(403, 'pin_required') on a wrong/missing PIN.
 */
export async function forgetRemembered(
  handle: string,
  opts?: { pin?: string; confirmForgot?: boolean },
): Promise<void> {
  await request(`/accounts/remembered/${encodeURIComponent(handle)}`, {
    method: 'DELETE',
    body: JSON.stringify({ pin: opts?.pin, confirm_forgot: opts?.confirmForgot }),
  })
}

interface RememberedSnapshot {
  handle: string
  label: string | null
  image_url: string | null
  has_pin: boolean
}

/** Refresh label/avatar/pin-presence for the handles the browser holds. Any
 *  handle the CP no longer knows is omitted, so the caller can prune it. */
export async function refreshRemembered(handles: string[]): Promise<RememberedSnapshot[]> {
  if (handles.length === 0) return []
  const q = encodeURIComponent(handles.join(','))
  const data = await request<{ accounts: RememberedSnapshot[] }>(
    `/accounts/remembered?handles=${q}`,
  )
  return data.accounts
}
