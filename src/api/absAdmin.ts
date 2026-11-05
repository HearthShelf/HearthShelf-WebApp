/**
 * ABS admin reads/writes over the direct ABS client (the WebApp data path).
 *
 * Mirrors the self-hosted HS admin API (src/api/admin.ts) endpoint-for-endpoint,
 * but every call takes the active server's AbsTarget and goes through absClient
 * (absGet/absPost/absPatch/absDelete) instead of a same-origin proxy. The WebApp
 * IS the server admin UI for app.hearthshelf.com, so this is the shared surface
 * the /config sections write against.
 *
 * Field shapes verified against audiobookshelf 2.35.1 controllers/serializers.
 */
import { absGet, absPost, absPatch, absDelete, absMediaUrl, AbsError } from '@/api/absClient'
import { progressFraction, type AbsTarget } from '@/api/absLibrary'
import { getAbsToken } from '@/lib/absTokens'
import {
  encodeNamePathParam,
  lastSeenByUser,
  normalizeActivityBuckets,
  onlineUserIds,
} from '@hearthshelf/core'
import type {
  ABSUserPermissions,
  ABSAdminUser,
  ABSUsersResponse,
  ABSLibraryFolder,
  ABSLibrarySettings,
  ABSLibrary,
  ABSBackup,
  ABSBackupsResponse,
  ABSApiKeyUserRef,
  ABSApiKey,
  ABSApiKeysResponse,
  ABSServerSettings,
  ABSListeningStats,
  ABSListeningSessionsResponse,
  ABSUserType,
  UserFormValues,
  ABSUsersOnlineResponse,
  ServiceAccountIdsResponse,
  LibraryFolderInput,
  LibraryUpdatePayload,
  MetadataProvider,
  ABSAdminSession,
  ABSSessionsResponse,
  ABSUserMediaProgress,
  ABSNotificationRule,
  ABSNotificationSettings,
  ABSEreaderDevice,
  ABSEmailSettings,
  ABSRssFeed,
  ABSAuthSettings,
  ABSCustomProvider,
  ABSServerStatsBucket,
  ABSServerStats,
  HSServerActivity,
  ABSLibraryStatsItem,
  ABSLibraryStats,
} from '@hearthshelf/core'

export type {
  ABSUserPermissions,
  ABSAdminUser,
  ABSUsersResponse,
  ABSLibraryFolder,
  ABSLibrarySettings,
  ABSBackup,
  ABSBackupsResponse,
  ABSApiKeyUserRef,
  ABSApiKey,
  ABSApiKeysResponse,
  ABSServerSettings,
  ABSUserType,
  UserFormValues,
  LibraryFolderInput,
  LibraryUpdatePayload,
  MetadataProvider,
  ABSAdminSession,
  ABSSessionsResponse,
  ABSUserMediaProgress,
  ABSNotificationRule,
  ABSNotificationSettings,
  ABSEreaderDevice,
  ABSEmailSettings,
  ABSRssFeed,
  ABSAuthSettings,
  ABSCustomProvider,
  ABSServerStatsBucket,
  ABSServerStats,
  HSServerActivity,
  ABSLibraryStatsItem,
  ABSLibraryStats,
}

// The full admin library shape is core's canonical ABSLibrary.
export type ABSAdminLibrary = ABSLibrary

// React Query keys for admin reads (scoped per server so a server switch
// re-fetches against the new target).
export const adminKeys = {
  users: (serverId: string) => ['admin', serverId, 'users'] as const,
  usersOnline: (serverId: string) => ['admin', serverId, 'users-online'] as const,
  lastSeen: (serverId: string) => ['admin', serverId, 'users-last-seen'] as const,
  libraries: (serverId: string) => ['admin', serverId, 'libraries'] as const,
  tagNames: (serverId: string) => ['admin', serverId, 'tag-names'] as const,
  searchProviders: (serverId: string) => ['admin', serverId, 'search-providers'] as const,
}

// --- Users ------------------------------------------------------------------

export function getUsers(t: AbsTarget): Promise<ABSUsersResponse> {
  return absGet<ABSUsersResponse>(t, '/api/users')
}

// The ids of users who are listening right now.
export async function getOnlineUserIds(t: AbsTarget): Promise<Set<string>> {
  return onlineUserIds(await absGet<ABSUsersOnlineResponse>(t, '/api/users/online'))
}

// Create an ABS user. ABS echoes back the created user on `user`. type defaults
// to 'admin' so machine-account callers keep working when they omit type.
export async function createUser(
  t: AbsTarget,
  opts: Partial<UserFormValues> & {
    username: string
    password: string
    type?: ABSUserType
  },
): Promise<{ user: ABSAdminUser }> {
  const res = await absPost<{ user: ABSAdminUser }>(t, '/api/users', {
    username: opts.username,
    password: opts.password,
    email: opts.email || null,
    type: opts.type ?? 'admin',
    isActive: opts.isActive ?? true,
    ...(opts.permissions ? { permissions: opts.permissions } : {}),
  })
  return res as { user: ABSAdminUser }
}

// Update an ABS user. Every field is optional - only what changed is sent. A
// non-empty `password` resets it; omit it to leave the password untouched. ABS
// returns { success, user }. Note: a non-root admin cannot edit a root user (403).
export async function updateUser(
  t: AbsTarget,
  userId: string,
  patch: Partial<UserFormValues> & { password?: string },
): Promise<{ success: boolean; user: ABSAdminUser }> {
  const body: Record<string, unknown> = {}
  if (patch.username !== undefined) body.username = patch.username
  if (patch.email !== undefined) body.email = patch.email || null
  if (patch.type !== undefined) body.type = patch.type
  if (patch.isActive !== undefined) body.isActive = patch.isActive
  if (patch.permissions !== undefined) body.permissions = patch.permissions
  if (patch.password) body.password = patch.password
  const res = await absPatch<{ success: boolean; user: ABSAdminUser }>(
    t,
    `/api/users/${userId}`,
    body,
  )
  return res as { success: boolean; user: ABSAdminUser }
}

export async function setUserActive(
  t: AbsTarget,
  userId: string,
  isActive: boolean,
): Promise<void> {
  await absPatch(t, `/api/users/${userId}`, { isActive })
}

export async function deleteUser(t: AbsTarget, userId: string): Promise<void> {
  await absDelete(t, `/api/users/${userId}`)
}

// All tag names in the server, for the per-user tag-access picker.
export async function getAllTagNames(t: AbsTarget): Promise<{ tags: string[] }> {
  const res = await absGet<{ tags?: string[] }>(t, '/api/tags')
  return { tags: res.tags ?? [] }
}

// --- Libraries (admin CRUD + scan) ------------------------------------------

export interface ABSLibrariesAdminResponse {
  libraries: ABSAdminLibrary[]
}

export async function getLibrariesAdmin(t: AbsTarget): Promise<ABSLibrariesAdminResponse> {
  const res = await absGet<{ libraries?: ABSAdminLibrary[] }>(t, '/api/libraries')
  return { libraries: res.libraries ?? [] }
}

// Create a library pointed at a folder. ABS auto-scans a newly created library,
// so the wizard does not need to call scanLibrary after this.
export async function createLibrary(
  t: AbsTarget,
  opts: { name: string; mediaType: 'book' | 'podcast'; fullPath: string },
): Promise<ABSAdminLibrary> {
  const res = await absPost<ABSAdminLibrary>(t, '/api/libraries', {
    name: opts.name,
    mediaType: opts.mediaType,
    icon: opts.mediaType === 'podcast' ? 'podcast' : 'audiobookshelf',
    folders: [{ fullPath: opts.fullPath }],
  })
  return res as ABSAdminLibrary
}

// Validate a folder path exists on the server (inside the container). Uses ABS's
// admin filesystem endpoint, which 400s for a missing/non-absolute path and 200s
// when it exists. Returns a tri-state so the caller can distinguish "missing"
// (red) from "couldn't check" (neutral). Admin-gated by ABS. Hits the server
// origin directly with the in-memory token (absMediaUrl carries it as a query).
export async function checkFolderExists(
  t: AbsTarget,
  fullPath: string,
): Promise<'exists' | 'missing' | 'unknown'> {
  const token = getAbsToken(t.serverId)
  if (!token) return 'unknown'
  const url = absMediaUrl(t, `/api/filesystem?path=${encodeURIComponent(fullPath)}&level=0`)
  if (!url) return 'unknown'
  try {
    const res = await fetch(url)
    if (res.ok) return 'exists'
    if (res.status === 400) return 'missing'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function scanLibrary(t: AbsTarget, libraryId: string, force = false): Promise<void> {
  await absPost(t, `/api/libraries/${libraryId}/scan${force ? '?force=1' : ''}`)
}

export async function updateLibrary(
  t: AbsTarget,
  libraryId: string,
  patch: LibraryUpdatePayload,
): Promise<unknown> {
  return absPatch(t, `/api/libraries/${libraryId}`, patch)
}

export async function deleteLibrary(t: AbsTarget, libraryId: string): Promise<void> {
  await absDelete(t, `/api/libraries/${libraryId}`)
}

// Quick-match every item in a book library against its metadata provider. ABS
// runs this as a fire-and-forget background task (returns 200 immediately) and
// rejects podcast libraries. Admin only.
export async function matchAllLibraryItems(t: AbsTarget, libraryId: string): Promise<void> {
  await absGet(t, `/api/libraries/${libraryId}/matchall`)
}

// Persist the display order of libraries. ABS wants the full list as
// [{ id, newOrder }]; newOrder is the 0-based position. Admin only.
export async function reorderLibraries(
  t: AbsTarget,
  order: { id: string; newOrder: number }[],
): Promise<{ libraries: ABSAdminLibrary[] }> {
  const res = await absPost<{ libraries: ABSAdminLibrary[] }>(t, '/api/libraries/order', order)
  return res as { libraries: ABSAdminLibrary[] }
}

// Remove on-disk metadata sidecar files across a library. ext 'json' targets the
// legacy metadata.json files, 'abs' the .abs metadata files. Destructive. Admin only.
export async function removeLibraryMetadata(
  t: AbsTarget,
  libraryId: string,
  ext: 'json' | 'abs',
): Promise<{ found: number; removed: number }> {
  const res = await absPost<{ found?: number; removed?: number }>(
    t,
    `/api/libraries/${libraryId}/remove-metadata?ext=${ext}`,
  )
  return { found: res?.found ?? 0, removed: res?.removed ?? 0 }
}

// --- Search / metadata providers (library edit modal) -----------------------

export async function getSearchProviders(t: AbsTarget): Promise<{
  providers: {
    books: MetadataProvider[]
    booksCovers: MetadataProvider[]
    podcasts: MetadataProvider[]
  }
}> {
  const res = await absGet<{
    providers?: {
      books?: MetadataProvider[]
      booksCovers?: MetadataProvider[]
      podcasts?: MetadataProvider[]
    }
  }>(t, '/api/search/providers')
  return {
    providers: {
      books: res.providers?.books ?? [],
      booksCovers: res.providers?.booksCovers ?? [],
      podcasts: res.providers?.podcasts ?? [],
    },
  }
}

// ===========================================================================
// Sessions / Backups / Logs / API keys / Service accounts
//
// Added in a self-contained block so concurrent edits to the sections above
// (libraries, users, etc.) don't collide. Endpoint shapes verified against the
// audiobookshelf ApiRouter (server/routers/ApiRouter.js) and controllers.
// ===========================================================================

// --- Query keys (extend the factory above) ---------------------------------
//
// adminKeys is declared `as const` near the top; these are the additional reads
// for the sections in this block, keyed per server so a switch re-fetches.
export const adminSectionKeys = {
  sessions: (serverId: string, page: number) => ['admin', serverId, 'sessions', page] as const,
  userStats: (serverId: string, userId: string) =>
    ['admin', serverId, 'user-stats', userId] as const,
  userSessions: (serverId: string, userId: string, page: number) =>
    ['admin', serverId, 'user-sessions', userId, page] as const,
  userProgress: (serverId: string, userId: string) =>
    ['admin', serverId, 'user-progress', userId] as const,
  backups: (serverId: string) => ['admin', serverId, 'backups'] as const,
  logs: (serverId: string) => ['admin', serverId, 'logs'] as const,
  apiKeys: (serverId: string) => ['admin', serverId, 'apikeys'] as const,
  serviceAccounts: (serverId: string) => ['admin', serverId, 'service-accounts'] as const,
}

// --- Listening sessions (all users, admin) ---------------------------------
// GET /api/sessions?page&itemsPerPage -> { total, numPages, page, itemsPerPage, sessions }

export async function getSessions(
  t: AbsTarget,
  page = 0,
  itemsPerPage = 50,
): Promise<ABSSessionsResponse> {
  const res = await absGet<Partial<ABSSessionsResponse>>(
    t,
    `/api/sessions?page=${page}&itemsPerPage=${itemsPerPage}`,
  )
  return {
    total: res.total ?? 0,
    numPages: res.numPages ?? 0,
    page: res.page ?? page,
    itemsPerPage: res.itemsPerPage ?? itemsPerPage,
    sessions: res.sessions ?? [],
  }
}

// --- Per-user listening data (admin) ----------------------------------------
// GET /api/users/:id/listening-stats and /listening-sessions - same payload
// shapes as the me-scoped reads, but readable by an admin for any user.

export function getUserListeningStats(t: AbsTarget, userId: string): Promise<ABSListeningStats> {
  return absGet<ABSListeningStats>(t, `/api/users/${userId}/listening-stats`)
}

export async function getUserListeningSessions(
  t: AbsTarget,
  userId: string,
  page = 0,
  itemsPerPage = 10,
): Promise<ABSListeningSessionsResponse> {
  const res = await absGet<Partial<ABSListeningSessionsResponse>>(
    t,
    `/api/users/${userId}/listening-sessions?page=${page}&itemsPerPage=${itemsPerPage}`,
  )
  return {
    total: res.total ?? 0,
    numPages: res.numPages ?? 0,
    page: res.page ?? page,
    itemsPerPage: res.itemsPerPage ?? itemsPerPage,
    sessions: res.sessions ?? [],
  }
}

// --- Per-user media progress (admin) ----------------------------------------
// GET /api/users/:id returns the full user record, including the mediaProgress
// rows ABS keeps per item. The me-scoped useMediaProgress() can't answer "why
// isn't THIS user's book finished?" - only this read can, and it carries the
// fields that explain it: how far in they are, whether ABS ever stamped
// finishedAt, and the duration it measured progress against (a 0 duration is
// the usual culprit - the fraction never reaches the finish threshold).

export async function getUserMediaProgress(
  t: AbsTarget,
  userId: string,
): Promise<ABSUserMediaProgress[]> {
  const res = await absGet<{ mediaProgress?: Partial<ABSUserMediaProgress>[] }>(
    t,
    `/api/users/${userId}`,
  )
  return (res.mediaProgress ?? []).map((p) => ({
    id: p.id ?? '',
    libraryItemId: p.libraryItemId ?? '',
    episodeId: p.episodeId ?? null,
    duration: p.duration ?? 0,
    progress: progressFraction(p),
    currentTime: p.currentTime ?? 0,
    isFinished: Boolean(p.isFinished),
    hideFromContinueListening: Boolean(p.hideFromContinueListening),
    lastUpdate: p.lastUpdate ?? 0,
    startedAt: p.startedAt ?? 0,
    finishedAt: p.finishedAt ?? null,
    displayTitle: p.displayTitle,
  }))
}

// DELETE /api/sessions/:id - removes a single playback session record (admin).
export async function deleteSession(t: AbsTarget, sessionId: string): Promise<void> {
  await absDelete(t, `/api/sessions/${sessionId}`)
}

// A real "last seen" per user, from one page of recent sessions (ABS returns them
// newest-first, so this covers everyone active lately). Map<userId, epochMs>.
export async function getLastSeenByUser(
  t: AbsTarget,
  sampleSize = 200,
): Promise<Map<string, number>> {
  const { sessions } = await getSessions(t, 0, sampleSize)
  return lastSeenByUser(sessions)
}

// --- Backups ----------------------------------------------------------------
// GET/POST /api/backups -> { backups, backupLocation }; DELETE /api/backups/:id
// echoes the updated list. Download/apply are GET routes (token via query).

export async function getBackups(t: AbsTarget): Promise<ABSBackupsResponse> {
  const res = await absGet<Partial<ABSBackupsResponse>>(t, '/api/backups')
  return { backups: res.backups ?? [], backupLocation: res.backupLocation ?? '' }
}

// Trigger a new backup now. ABS responds with the updated backups list.
export async function createBackup(t: AbsTarget): Promise<void> {
  await absPost(t, '/api/backups')
}

export async function deleteBackup(t: AbsTarget, backupId: string): Promise<void> {
  await absDelete(t, `/api/backups/${backupId}`)
}

// Restore the server from a backup. ABS's apply route is a GET; the server
// shuts down and re-imports, so the response is best-effort. Token rides as a
// query param (this is a navigation-style GET, not a fetch with headers).
export function backupDownloadUrl(t: AbsTarget, backupId: string): string | null {
  return absMediaUrl(t, `/api/backups/${backupId}/download`)
}

// Fetch a backup's bytes with the bearer header (for a saveBlob download), so the
// downloaded file uses the backup's real filename rather than a query-string URL.
export async function downloadBackupBlob(t: AbsTarget, backupId: string): Promise<Blob> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new AbsError(401, 'not_connected')
  const res = await fetch(`${t.serverUrl.replace(/\/$/, '')}/api/backups/${backupId}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new AbsError(res.status, res.statusText)
  return res.blob()
}

export async function applyBackup(t: AbsTarget, backupId: string): Promise<void> {
  await absGet(t, `/api/backups/${backupId}/apply`)
}

// Upload a .audiobookshelf backup file. POST /api/backups/upload is multipart;
// ABS reads the file off `req.files.file`. We hit the origin directly with the
// in-memory token since absPost serializes JSON, not FormData.
export async function uploadBackup(t: AbsTarget, file: File): Promise<void> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new AbsError(401, 'not_connected')
  const form = new FormData()
  form.append('file', file)
  const url = `${t.serverUrl.replace(/\/$/, '')}/api/backups/upload`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!res.ok) throw new AbsError(res.status, res.statusText)
}

// --- Logs -------------------------------------------------------------------
// Infra-log fetching was removed with the admin log viewer; server errors now
// go to the error dashboard instead.
// Re-export the shared type for any remaining importer.
export type { ABSLogEntry } from '@hearthshelf/core'

// --- API keys ---------------------------------------------------------------
// GET/POST /api/api-keys; DELETE /api/api-keys/:id

export async function getApiKeys(t: AbsTarget): Promise<ABSApiKeysResponse> {
  const res = await absGet<{ apiKeys?: ABSApiKey[] }>(t, '/api/api-keys')
  return { apiKeys: res.apiKeys ?? [] }
}

// ABS requires the owning userId on create. Returns the new key plus its raw
// token (shown once) on apiKey.apiKey. expiresIn is optional (seconds).
export async function createApiKey(
  t: AbsTarget,
  name: string,
  userId: string,
  expiresIn?: number | null,
): Promise<{ apiKey: ABSApiKey }> {
  const res = await absPost<{ apiKey: ABSApiKey }>(t, '/api/api-keys', {
    name,
    userId,
    isActive: true,
    ...(expiresIn ? { expiresIn } : {}),
  })
  return res as { apiKey: ABSApiKey }
}

export async function deleteApiKey(t: AbsTarget, keyId: string): Promise<void> {
  await absDelete(t, `/api/api-keys/${keyId}`)
}

// --- Service accounts (machine logins) --------------------------------------
//
// Service accounts ARE regular ABS admin users; "service account" is just a
// grouping HearthShelf applies. The accounts and their API keys live entirely in
// ABS - this only persists which ABS user ids the admin has tagged. That tagged
// set is owned by the connected server's own HearthShelf backend at
// /hs/service-accounts (mounted alongside /hs/hosted/* which the connect flow
// already uses), so the framing survives restarts and follows the instance
// across devices - unlike a per-browser store. Reached cross-origin with the
// per-server ABS bearer, the same way absQuestGiver hits /hs/questgiver/*.

// Query key for the tagged-id read (scoped per server so a switch re-fetches).
export const serviceAccountKeys = {
  ids: (serverId: string) => ['service-accounts', serverId, 'ids'] as const,
}

async function svcFetch<T>(t: AbsTarget, path: string, options: RequestInit = {}): Promise<T> {
  const token = getAbsToken(t.serverId)
  if (!token) throw new AbsError(401, 'not_connected')
  const origin = t.serverUrl.replace(/\/$/, '')
  const res = await fetch(`${origin}/hs/service-accounts${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  if (!res.ok) throw new AbsError(res.status, `service-accounts ${res.status}`)
  return res.json() as Promise<T>
}

// The ABS user ids HearthShelf has tagged as service accounts.
export function getServiceAccountIds(t: AbsTarget): Promise<ServiceAccountIdsResponse> {
  return svcFetch<ServiceAccountIdsResponse>(t, '')
}

export function tagServiceAccount(
  t: AbsTarget,
  userId: string,
): Promise<ServiceAccountIdsResponse> {
  return svcFetch<ServiceAccountIdsResponse>(t, '', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  })
}

export function untagServiceAccount(
  t: AbsTarget,
  userId: string,
): Promise<ServiceAccountIdsResponse> {
  return svcFetch<ServiceAccountIdsResponse>(t, `/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  })
}

// ===========================================================================
// Content / Features / Community / Insights sections
//
// Self-contained block appended for the second admin pass (settings,
// notifications, email, metadata utils, RSS, auth, and the stats reads).
// Every call is target-based over absClient, mirroring the self-hosted HS admin
// API (src/api/admin.ts) but hitting ABS directly. Endpoint shapes verified
// against the audiobookshelf ApiRouter + controllers. Do NOT reorder the exports
// above - they are owned by earlier passes.
// ===========================================================================

export const adminContentKeys = {
  serverSettings: (serverId: string) => ['admin', serverId, 'server-settings'] as const,
  notifications: (serverId: string) => ['admin', serverId, 'notifications'] as const,
  email: (serverId: string) => ['admin', serverId, 'email'] as const,
  tags: (serverId: string) => ['admin', serverId, 'tags'] as const,
  genres: (serverId: string) => ['admin', serverId, 'genres'] as const,
  rss: (serverId: string) => ['admin', serverId, 'rss'] as const,
  auth: (serverId: string) => ['admin', serverId, 'auth'] as const,
  customProviders: (serverId: string) => ['admin', serverId, 'custom-providers'] as const,
  serverStats: (serverId: string) => ['admin', serverId, 'server-stats'] as const,
  serverActivity: (serverId: string) => ['admin', serverId, 'server-activity'] as const,
  libraryStats: (serverId: string, libraryId: string) =>
    ['admin', serverId, 'library-stats', libraryId] as const,
}

// --- Server settings (general: scanner / display) ---------------------------
// ABS has no dedicated GET for server settings; POST /api/authorize returns the
// full serverSettings blob, so we read it from there. PATCH /api/settings
// persists a partial and echoes the updated settings back.

export async function getServerSettings(t: AbsTarget): Promise<ABSServerSettings> {
  const res = await absPost<{ serverSettings?: ABSServerSettings }>(t, '/api/authorize')
  return res?.serverSettings ?? ({} as ABSServerSettings)
}

export async function updateServerSettings(
  t: AbsTarget,
  patch: Partial<ABSServerSettings>,
): Promise<{ serverSettings: ABSServerSettings }> {
  const res = await absPatch<{ serverSettings: ABSServerSettings }>(t, '/api/settings', patch)
  return (res ?? { serverSettings: {} }) as { serverSettings: ABSServerSettings }
}

// --- Notifications (admin) --------------------------------------------------
// GET /api/notifications -> { settings, data }; PATCH /api/notifications for the
// top-level settings; PATCH /api/notifications/:id to toggle a single rule.

export async function getNotifications(
  t: AbsTarget,
): Promise<{ settings: ABSNotificationSettings }> {
  const res = await absGet<{ settings?: Partial<ABSNotificationSettings> }>(t, '/api/notifications')
  const s = res.settings ?? {}
  return {
    settings: {
      appriseType: s.appriseType ?? null,
      appriseApiUrl: s.appriseApiUrl ?? null,
      notifications: s.notifications ?? [],
      maxFailedAttempts: s.maxFailedAttempts ?? 5,
      notificationDelay: s.notificationDelay ?? 1000,
    },
  }
}

export async function updateNotifications(
  t: AbsTarget,
  settings: Partial<ABSNotificationSettings>,
): Promise<void> {
  await absPatch(t, '/api/notifications', settings)
}

// Toggle a single notification rule on/off. The id rides in both path and body.
export async function updateNotificationRule(
  t: AbsTarget,
  id: string,
  patch: { enabled?: boolean },
): Promise<void> {
  await absPatch(t, `/api/notifications/${id}`, { id, ...patch })
}

// --- Email (admin) ----------------------------------------------------------
// GET/PATCH /api/emails/settings; POST /api/emails/test; POST
// /api/emails/ereader-devices replaces the full device list.

export async function getEmailSettings(t: AbsTarget): Promise<{ settings: ABSEmailSettings }> {
  const res = await absGet<{ settings?: Partial<ABSEmailSettings> }>(t, '/api/emails/settings')
  const s = res.settings ?? {}
  return {
    settings: {
      host: s.host ?? null,
      port: s.port ?? null,
      secure: Boolean(s.secure),
      rejectUnauthorized: s.rejectUnauthorized ?? true,
      user: s.user ?? null,
      fromAddress: s.fromAddress ?? null,
      testAddress: s.testAddress ?? null,
      ereaderDevices: s.ereaderDevices ?? [],
    },
  }
}

// PATCH accepts a partial of the email settings model. `pass` is write-only on
// the server (never returned by GET), so only send it when the user enters one.
export async function updateEmailSettings(
  t: AbsTarget,
  patch: Partial<ABSEmailSettings> & { pass?: string },
): Promise<void> {
  await absPatch(t, '/api/emails/settings', patch)
}

// Sends a test email to settings.testAddress using the saved SMTP config.
export async function sendTestEmail(t: AbsTarget): Promise<void> {
  await absPost(t, '/api/emails/test')
}

// Replaces the full eReader device list (name + email per device).
export async function updateEreaderDevices(
  t: AbsTarget,
  ereaderDevices: ABSEreaderDevice[],
): Promise<{ ereaderDevices: ABSEreaderDevice[] }> {
  const res = await absPost<{ ereaderDevices?: ABSEreaderDevice[] }>(
    t,
    '/api/emails/ereader-devices',
    { ereaderDevices },
  )
  return { ereaderDevices: res?.ereaderDevices ?? ereaderDevices }
}

// --- Metadata utils (tags / genres) -----------------------------------------
// ABS decodes the DELETE path param as base64 (Buffer.from(decoded, 'base64')),
// so the tag/genre name must be base64-encoded then URL-encoded.

export async function getAllTags(t: AbsTarget): Promise<{ tags: string[] }> {
  const res = await absGet<{ tags?: string[] }>(t, '/api/tags')
  return { tags: res.tags ?? [] }
}

export async function getAllGenres(t: AbsTarget): Promise<{ genres: string[] }> {
  const res = await absGet<{ genres?: string[] }>(t, '/api/genres')
  return { genres: res.genres ?? [] }
}

export async function renameTag(t: AbsTarget, tag: string, newTag: string): Promise<void> {
  await absPost(t, '/api/tags/rename', { tag, newTag })
}

export async function deleteTag(t: AbsTarget, tag: string): Promise<void> {
  await absDelete(t, `/api/tags/${encodeNamePathParam(tag)}`)
}

export async function renameGenre(t: AbsTarget, genre: string, newGenre: string): Promise<void> {
  await absPost(t, '/api/genres/rename', { genre, newGenre })
}

export async function deleteGenre(t: AbsTarget, genre: string): Promise<void> {
  await absDelete(t, `/api/genres/${encodeNamePathParam(genre)}`)
}

// --- RSS feeds (admin) ------------------------------------------------------
// GET /api/feeds -> { feeds }; POST /api/feeds/:id/close closes one.

export async function getRssFeeds(t: AbsTarget): Promise<{ feeds: ABSRssFeed[] }> {
  const res = await absGet<{ feeds?: ABSRssFeed[] }>(t, '/api/feeds')
  return { feeds: res.feeds ?? [] }
}

export async function closeRssFeed(t: AbsTarget, feedId: string): Promise<void> {
  await absPost(t, `/api/feeds/${feedId}/close`)
}

// --- Auth settings (admin) --------------------------------------------------
// GET/PATCH /api/auth-settings. PATCH iterates over the keys provided and
// updates each in place, so a partial is safe. authOpenIDClientSecret is
// write-only (never returned by GET).

export async function getAuthSettings(t: AbsTarget): Promise<ABSAuthSettings> {
  const res = await absGet<Partial<ABSAuthSettings>>(t, '/api/auth-settings')
  return {
    authActiveAuthMethods: res.authActiveAuthMethods ?? ['local'],
    authLoginCustomMessage: res.authLoginCustomMessage ?? null,
    authOpenIDIssuerURL: res.authOpenIDIssuerURL ?? null,
    authOpenIDClientID: res.authOpenIDClientID ?? null,
    authOpenIDButtonText: res.authOpenIDButtonText ?? null,
    authOpenIDAutoLaunch: Boolean(res.authOpenIDAutoLaunch),
    authOpenIDAutoRegister: Boolean(res.authOpenIDAutoRegister),
  }
}

export async function updateAuthSettings(
  t: AbsTarget,
  patch: Partial<ABSAuthSettings> & { authOpenIDClientSecret?: string },
): Promise<void> {
  await absPatch(t, '/api/auth-settings', patch)
}

// --- Custom metadata providers (integrations, read-only) --------------------
// GET /api/custom-metadata-providers. Built-in providers (Audible, Google,
// iTunes, Open Library) are always available and not listed here.

export async function getCustomProviders(
  t: AbsTarget,
): Promise<{ providers: ABSCustomProvider[] }> {
  const res = await absGet<{ providers?: ABSCustomProvider[] }>(t, '/api/custom-metadata-providers')
  return { providers: res.providers ?? [] }
}

// --- Stats (insights) -------------------------------------------------------
// GET /api/stats/server (server-wide totals) and
// GET /api/libraries/:id/stats (per-library breakdown). Admin reads.

const EMPTY_BUCKET: ABSServerStatsBucket = { numItems: 0, numAudioFiles: 0, totalSize: 0 }

export async function getServerStats(t: AbsTarget): Promise<ABSServerStats> {
  const res = await absGet<Partial<ABSServerStats>>(t, '/api/stats/server')
  return {
    books: res.books ?? EMPTY_BUCKET,
    podcasts: res.podcasts ?? EMPTY_BUCKET,
    total: res.total ?? EMPTY_BUCKET,
  }
}

// Server-computed anonymous all-user activity. Older/plain ABS targets do not
// have this HearthShelf route, so null means the Server Stats card should hide.
export async function getServerActivity(t: AbsTarget): Promise<HSServerActivity | null> {
  const token = getAbsToken(t.serverId)
  if (!token) return null
  try {
    const tz = new Date().getTimezoneOffset()
    const res = await fetch(`${t.serverUrl.replace(/\/$/, '')}/hs/stats/server-activity?tz=${tz}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) return null
    const raw = (await res.json()) as Partial<HSServerActivity>
    return {
      available: raw.available === true,
      byHour: normalizeActivityBuckets(raw.byHour, 24),
      byDay: normalizeActivityBuckets(raw.byDay, 7),
    }
  } catch {
    return null
  }
}

export async function getLibraryStats(t: AbsTarget, libraryId: string): Promise<ABSLibraryStats> {
  const res = await absGet<Partial<ABSLibraryStats>>(t, `/api/libraries/${libraryId}/stats`)
  return {
    totalItems: res.totalItems ?? 0,
    totalAuthors: res.totalAuthors ?? 0,
    totalGenres: res.totalGenres ?? 0,
    totalSize: res.totalSize ?? 0,
    totalDuration: res.totalDuration ?? 0,
    numAudioTracks: res.numAudioTracks ?? 0,
    largestItems: res.largestItems ?? [],
    longestItems: res.longestItems ?? [],
  }
}
