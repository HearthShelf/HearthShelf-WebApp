/**
 * Hosted-mode + runtime admin client against the connected server's HearthShelf
 * backend (/hs/hosted/* and /hs/runtime/*).
 *
 * Like absSocial.ts / absQuestGiver.ts, these endpoints live on the connected
 * server's own origin and are served by the HearthShelf Node backend (NOT the
 * ABS-native /api/* surface). We reach them the same way absClient does: the
 * server's public origin + the per-server ABS bearer token.
 *
 * These drive the HearthShelf Connect admin page (pairing, public address,
 * reachability, invites) and the server name / email-relay controls. Box-side
 * actions (pair, disconnect, port-check) behave as the backend allows; callers
 * surface errors rather than break the page.
 */
import { getAbsToken } from '@/lib/absTokens'
import { mintGrant } from '@/api/controlPlane'
import type { AbsTarget } from './absLibrary'

export type HSMode = 'slim' | 'aio' | 'hosted'

// Carries the backend's machine-readable error code + HTTP status so callers can
// map them to friendly copy. `detail` is an optional technical note (logs only).
export class HostedError extends Error {
  code: string
  status: number
  detail: string | null
  constructor(code: string, status: number, detail: string | null) {
    super(code)
    this.name = 'HostedError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

function origin(t: AbsTarget): string {
  return t.serverUrl.replace(/\/$/, '')
}

async function hsFetch<T>(t: AbsTarget, path: string, options: RequestInit = {}): Promise<T> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new HostedError('no_token', 401, null)
  let res: Response
  try {
    res = await fetch(`${origin(t)}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    })
  } catch {
    throw new HostedError('network', 0, null)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = (data as { error?: string }).error || `http_${res.status}`
    const detail = (data as { detail?: string }).detail || null
    throw new HostedError(error, res.status, detail)
  }
  return data as T
}

export const hostedKeys = {
  status: (serverId: string) => ['hosted', 'status', serverId] as const,
  hsdirect: (serverId: string) => ['hosted', 'hsdirect', serverId] as const,
  emailRelay: (serverId: string) => ['hosted', 'email-relay', serverId] as const,
  versions: (serverId: string) => ['hosted', 'versions', serverId] as const,
  telemetry: (serverId: string) => ['hosted', 'telemetry', serverId] as const,
}

// --- Anonymous usage telemetry (opt-in) --------------------------------------

/** Exactly what one anonymous report would contain right now, shown in the
 *  opt-in disclosure. All fields are coarse buckets or lifetime counts; the id is
 *  redacted server-side. */
export interface TelemetryPreview {
  telemetry_id: string
  hs_version: string | null
  abs_version: string | null
  mode: string
  user_bucket: string
  book_bucket: string
  quests_given: number
  quests_accepted: number
  books_finished: number
  club_books_finished: number
  clubs_active: number
}

export interface TelemetryConfig {
  enabled: boolean
  /** True when the signed-in user may change the setting (server admin). */
  canEdit: boolean
  payloadPreview: TelemetryPreview
}

export async function getTelemetryConfig(t: AbsTarget): Promise<TelemetryConfig> {
  return hsFetch<TelemetryConfig>(t, '/hs/telemetry')
}

export async function setTelemetryEnabled(
  t: AbsTarget,
  enabled: boolean,
): Promise<{ enabled: boolean; canEdit: boolean }> {
  return hsFetch(t, '/hs/telemetry', {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  })
}

// --- Versions (ABS + HearthShelf backend) ------------------------------------
//
// Both reads are public (no auth): ABS reports its version on /status, and the
// HearthShelf backend echoes its own version on /hs/runtime. Either may be
// absent (older box, or a slim ABS with no HS backend), so both are nullable.

export interface ServerVersions {
  /** audiobookshelf server version, e.g. "2.35.1". */
  absVersion: string | null
  /** HearthShelf backend version, e.g. "0.1.0". null if no HS backend. */
  hsVersion: string | null
}

export async function getServerVersions(t: AbsTarget): Promise<ServerVersions> {
  const base = origin(t)
  const [abs, hs] = await Promise.all([
    fetch(`${base}/status`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    fetch(`${base}/hs/runtime`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ])
  return {
    absVersion: (abs as { serverVersion?: string } | null)?.serverVersion ?? null,
    hsVersion: (hs as { hsVersion?: string } | null)?.hsVersion ?? null,
  }
}

// --- Runtime: server name ----------------------------------------------------

/** Set the server's own display name (Server Settings edit + onboarding). */
export function setServerName(t: AbsTarget, name: string): Promise<{ serverName: string | null }> {
  return hsFetch<{ serverName: string | null }>(t, '/hs/runtime/server-name', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

// --- Connection status -------------------------------------------------------

export interface HostedStatus {
  mode: HSMode
  paired: boolean
  hasAbsAdminToken: boolean
  issuer: string | null
}

export function getHostedStatus(t: AbsTarget): Promise<HostedStatus> {
  return hsFetch<HostedStatus>(t, '/hs/hosted/config', { method: 'GET' })
}

// hs.direct provisioning state. 'pending' = paired but the cert isn't installed
// yet; 'active' = the publicUrl is usable and reachability can be tested.
export interface HsDirectState {
  status: 'opted_out' | 'not_paired' | 'pending' | 'active'
  publicUrl: string | null
  host: string | null
}

export function getHsDirectState(t: AbsTarget): Promise<HsDirectState> {
  return hsFetch<HsDirectState>(t, '/hs/hosted/hsdirect', { method: 'GET' })
}

// --- Pairing -----------------------------------------------------------------

export interface PairResult {
  code: string
  expires_at: number
  control_plane: string
  issuer: string
}

export interface PairStatus {
  claimed: boolean
  expired: boolean
  name: string | null
  claimedByEmail: string | null
}

export function pollPairStatus(t: AbsTarget, code: string): Promise<PairStatus> {
  return hsFetch<PairStatus>(t, '/hs/hosted/pair-status', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

/** Start pairing with the control plane; returns the code to enter on app.hs.com. */
export function startPairing(
  t: AbsTarget,
  opts?: { controlPlaneUrl?: string; publicUrl?: string; name?: string },
): Promise<PairResult> {
  return hsFetch<PairResult>(t, '/hs/hosted/pair', {
    method: 'POST',
    body: JSON.stringify({
      controlPlaneUrl: opts?.controlPlaneUrl,
      publicUrl: opts?.publicUrl,
      name: opts?.name,
    }),
  })
}

/** Disconnect from app.hearthshelf.com: deregister + clear local trust state. */
export function disconnectHosted(t: AbsTarget): Promise<{ ok: boolean }> {
  return hsFetch<{ ok: boolean }>(t, '/hs/hosted/disconnect', { method: 'POST' })
}

// --- Reachability ------------------------------------------------------------

/** Port reachability via the hs.direct VPS connecting back to this box's IP. */
export interface PortCheckResult {
  open: boolean
  port: number
  publicIp: string | null
}
export function checkPort(t: AbsTarget): Promise<PortCheckResult> {
  return hsFetch<PortCheckResult>(t, '/hs/hosted/port-check', { method: 'GET' })
}

// --- Admin recovery (break-glass) --------------------------------------------

export interface RecoverAdminsResult {
  ok: boolean
  recovered: { id: string; username: string }[]
  count: number
}

/**
 * Re-enable disabled admin accounts when every admin is locked out. Authenticated
 * by a fresh control-plane grant (NOT an ABS token - there may be no usable admin
 * login left), which the box verifies as a server-admin grant and acts on with
 * its stored service-root token. Requires the server to be paired ("connect"
 * enabled). The grant is minted Clerk-side for THIS server, so only a linked
 * server admin can trigger it.
 */
export async function recoverAdmins(t: AbsTarget): Promise<RecoverAdminsResult> {
  const { grant } = await mintGrant(t.serverId)
  let res: Response
  try {
    res = await fetch(`${origin(t)}/hs/hosted/recover-admins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ grant }),
    })
  } catch {
    throw new HostedError('network', 0, null)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = (data as { error?: string }).error || `http_${res.status}`
    throw new HostedError(error, res.status, null)
  }
  return data as RecoverAdminsResult
}

/**
 * Store a freshly-minted connection secret on the box (owner recovery). Paired
 * with the control plane's /servers/:id/reset-secret: the SPA mints a new secret
 * there, then hands it here so the box re-syncs without deregistering. The box
 * verifies the secret against the control plane before persisting it. ABS-admin
 * authenticated (hsFetch bearer).
 */
export function recoverConnectionSecret(
  t: AbsTarget,
  serverSecret: string,
): Promise<{ ok: boolean }> {
  return hsFetch<{ ok: boolean }>(t, '/hs/hosted/recover-secret', {
    method: 'POST',
    body: JSON.stringify({ server_secret: serverSecret }),
  })
}

// --- Invites -----------------------------------------------------------------

export interface InviteResult {
  ok: boolean
  email: string
  role: 'admin' | 'user'
  emailed: boolean
}

/** Invite someone by email to this server (forwarded to the control plane). */
export function inviteFromServer(
  t: AbsTarget,
  email: string,
  role: 'admin' | 'user',
): Promise<InviteResult> {
  return hsFetch<InviteResult>(t, '/hs/hosted/invite', {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  })
}

// --- Email relay ("Use HearthShelf email") -----------------------------------

export interface EmailRelayStatus {
  /** Paired + not opted out: the box can offer "use HearthShelf email". */
  available: boolean
  paired: boolean
  optedOut: boolean
  /** ABS is currently pointed at the loopback relay. */
  active: boolean
  host: string
  port: number
}

/** Whether this box can send email through HearthShelf, and if it's enabled. */
export function getEmailRelayStatus(t: AbsTarget): Promise<EmailRelayStatus> {
  return hsFetch<EmailRelayStatus>(t, '/hs/hosted/email-relay', { method: 'GET' })
}

/** Point ABS's SMTP at the loopback relay (1-click "use HearthShelf email"). */
export function enableEmailRelay(
  t: AbsTarget,
): Promise<{ ok: boolean; host: string; port: number }> {
  return hsFetch(t, '/hs/hosted/email-relay/apply', { method: 'POST' })
}
