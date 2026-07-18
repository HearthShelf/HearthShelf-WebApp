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
import type {
  HSMode,
  HSRuntimeInfo,
  HSTelemetryStatus,
  HSTelemetryPayloadPreview,
  HSHostedConfigStatus,
  HSHostedHsDirectState,
  HSHostedPairResponse,
  HSHostedPortCheckResult,
  HSHostedRecoverAdminsResponse,
  HSHostedEmailRelayStatus,
  HSServiceHealth,
  HSServiceCredentialOverrideRequest,
} from '@hearthshelf/core'

export type { HSMode }

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
  runtime: (serverId: string) => ['hosted', 'runtime', serverId] as const,
  invites: (serverId: string) => ['hosted', 'invites', serverId] as const,
  linkedUsers: (serverId: string) => ['hosted', 'linked-users', serverId] as const,
}

// --- Runtime info (GET /hs/runtime, unauthenticated) -------------------------
//
// The box's boot-time runtime config. The WebApp needs `serviceUsername` from
// here: on AIO the box auto-creates a HearthShelf service root (default
// `hearthshelf-service`) that is a regular ABS admin user but must be framed as
// a machine account, not a person. It is NOT in the /hs/service-accounts tagged
// set (that only holds ids an admin tagged by hand), so the only way to identify
// it is by username against this field. Returns null on a box that predates the
// field or a server without a HearthShelf backend.
export async function getServerRuntime(t: AbsTarget): Promise<HSRuntimeInfo | null> {
  try {
    const res = await fetch(`${origin(t)}/hs/runtime`)
    if (!res.ok) return null
    return (await res.json()) as HSRuntimeInfo
  } catch {
    return null
  }
}

// --- Anonymous usage telemetry (opt-in) --------------------------------------

/** Exactly what one anonymous report would contain right now, shown in the
 *  opt-in disclosure. All fields are coarse buckets or lifetime counts; the id is
 *  redacted server-side. */
export type TelemetryPreview = HSTelemetryPayloadPreview

export type TelemetryConfig = HSTelemetryStatus

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

export type HostedStatus = HSHostedConfigStatus

export function getHostedStatus(t: AbsTarget): Promise<HostedStatus> {
  return hsFetch<HostedStatus>(t, '/hs/hosted/config', { method: 'GET' })
}

// --- Service account credential health --------------------------------------

// Live health of the ABS admin credential used to provision invited users.
export function getServiceHealth(t: AbsTarget): Promise<HSServiceHealth> {
  return hsFetch<HSServiceHealth>(t, '/hs/hosted/service-health', { method: 'GET' })
}

// Reset the credential by minting a fresh durable key from the current admin
// session. The one-click fix when the credential has gone stale/broken.
export function resetServiceCredential(t: AbsTarget): Promise<{ ok: true; status: string }> {
  return hsFetch(t, '/hs/hosted/service-credential/reset', { method: 'POST' })
}

// Manual recovery when auto-repair can't help: a new service-account password,
// or a known-good admin token/key pasted directly.
export function overrideServiceCredential(
  t: AbsTarget,
  body: HSServiceCredentialOverrideRequest,
): Promise<{ ok: true; status: string }> {
  return hsFetch(t, '/hs/hosted/service-credential/override', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// hs.direct provisioning state. 'pending' = paired but the cert isn't installed
// yet; 'active' = the publicUrl is usable and reachability can be tested.
export type HsDirectState = HSHostedHsDirectState

export function getHsDirectState(t: AbsTarget): Promise<HsDirectState> {
  return hsFetch<HsDirectState>(t, '/hs/hosted/hsdirect', { method: 'GET' })
}

// --- Pairing -----------------------------------------------------------------

export type PairResult = HSHostedPairResponse

// Kept local: core's HSHostedPairStatusResult is an opaque Record<string,
// unknown> (control-plane-owned passthrough), but the SPA reads these concrete
// fields off the poll response. See migration report.
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
export type PortCheckResult = HSHostedPortCheckResult
export function checkPort(t: AbsTarget): Promise<PortCheckResult> {
  return hsFetch<PortCheckResult>(t, '/hs/hosted/port-check', { method: 'GET' })
}

// --- Admin recovery (break-glass) --------------------------------------------

export type RecoverAdminsResult = HSHostedRecoverAdminsResponse

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

// Kept local: core's HSHostedInviteResult is an opaque Record<string, unknown>
// (control-plane-owned passthrough), but callers read these concrete fields off
// the invite response. See migration report.
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

export interface PendingInvite {
  email: string
  role: 'admin' | 'user'
  created_at: number
}

/** Pending invites for this server (forwarded to the control plane). */
export async function getPendingInvites(t: AbsTarget): Promise<PendingInvite[]> {
  const res = await hsFetch<{ invites?: PendingInvite[] }>(t, '/hs/hosted/invites', {
    method: 'GET',
  })
  return res.invites ?? []
}

// The ABS user ids that have signed in via app.hearthshelf.com on this server.
// Box-local (hosted_user_keys) - no control-plane round trip.
export async function getLinkedAbsUserIds(t: AbsTarget): Promise<Set<string>> {
  const res = await hsFetch<{ linked?: { absUserId: string; email: string }[] }>(
    t,
    '/hs/hosted/linked-users',
    { method: 'GET' },
  )
  return new Set((res.linked ?? []).map((l) => l.absUserId))
}

// --- Email relay ("Use HearthShelf email") -----------------------------------

export type EmailRelayStatus = HSHostedEmailRelayStatus

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
