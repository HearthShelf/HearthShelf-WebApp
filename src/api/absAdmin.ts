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
import type { AbsTarget } from '@/api/absLibrary'
import { getAbsToken } from '@/lib/absTokens'
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
}

// The full admin library shape is core's canonical ABSLibrary.
export type ABSAdminLibrary = ABSLibrary

// React Query keys for admin reads (scoped per server so a server switch
// re-fetches against the new target).
export const adminKeys = {
  users: (serverId: string) => ['admin', serverId, 'users'] as const,
  libraries: (serverId: string) => ['admin', serverId, 'libraries'] as const,
  tagNames: (serverId: string) => ['admin', serverId, 'tag-names'] as const,
  searchProviders: (serverId: string) => ['admin', serverId, 'search-providers'] as const,
}

// --- Users ------------------------------------------------------------------

export type ABSUserType = 'admin' | 'user' | 'guest'

// Fields shared by create and edit. permissions is partial - only the toggles we
// expose are sent; ABS keeps its defaults for the rest. librariesAccessible /
// itemTagsSelected live inside permissions in the current ABS model.
export interface UserFormValues {
  username: string
  email?: string | null
  type: ABSUserType
  isActive: boolean
  permissions: Partial<ABSUserPermissions>
}

export function getUsers(t: AbsTarget): Promise<ABSUsersResponse> {
  return absGet<ABSUsersResponse>(t, '/api/users')
}

// Create an ABS user. ABS echoes back the created user on `user`. type defaults
// to 'admin' so machine-account callers keep working when they omit type.
export async function createUser(
  t: AbsTarget,
  opts: Partial<UserFormValues> & {
    username: string
    password: string
    type?: ABSUserType
  }
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
  patch: Partial<UserFormValues> & { password?: string }
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
    body
  )
  return res as { success: boolean; user: ABSAdminUser }
}

export async function setUserActive(
  t: AbsTarget,
  userId: string,
  isActive: boolean
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

// A folder entry in a library update payload. Existing folders keep their id;
// new folders are sent with just fullPath. ABS treats the array as the complete
// desired set - any existing folder absent from it is REMOVED along with all its
// library items (destructive). See LibraryController.update.
export interface LibraryFolderInput {
  id?: string
  fullPath: string
}

// The editable library fields. All optional - only changed keys are sent.
export interface LibraryUpdatePayload {
  name?: string
  provider?: string
  icon?: string
  folders?: LibraryFolderInput[]
  settings?: Partial<ABSLibrarySettings>
}

// Create a library pointed at a folder. ABS auto-scans a newly created library,
// so the wizard does not need to call scanLibrary after this.
export async function createLibrary(
  t: AbsTarget,
  opts: { name: string; mediaType: 'book' | 'podcast'; fullPath: string }
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
  fullPath: string
): Promise<'exists' | 'missing' | 'unknown'> {
  const token = getAbsToken(t.serverId)
  if (!token) return 'unknown'
  const url = absMediaUrl(
    t,
    `/api/filesystem?path=${encodeURIComponent(fullPath)}&level=0`
  )
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

export async function scanLibrary(
  t: AbsTarget,
  libraryId: string,
  force = false
): Promise<void> {
  await absPost(t, `/api/libraries/${libraryId}/scan${force ? '?force=1' : ''}`)
}

export async function updateLibrary(
  t: AbsTarget,
  libraryId: string,
  patch: LibraryUpdatePayload
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
  order: { id: string; newOrder: number }[]
): Promise<{ libraries: ABSAdminLibrary[] }> {
  const res = await absPost<{ libraries: ABSAdminLibrary[] }>(t, '/api/libraries/order', order)
  return res as { libraries: ABSAdminLibrary[] }
}

// Remove on-disk metadata sidecar files across a library. ext 'json' targets the
// legacy metadata.json files, 'abs' the .abs metadata files. Destructive. Admin only.
export async function removeLibraryMetadata(
  t: AbsTarget,
  libraryId: string,
  ext: 'json' | 'abs'
): Promise<{ found: number; removed: number }> {
  const res = await absPost<{ found?: number; removed?: number }>(
    t,
    `/api/libraries/${libraryId}/remove-metadata?ext=${ext}`
  )
  return { found: res?.found ?? 0, removed: res?.removed ?? 0 }
}

// --- Search / metadata providers (library edit modal) -----------------------

export interface MetadataProvider {
  text: string
  value: string
}

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
  sessions: (serverId: string, page: number) =>
    ['admin', serverId, 'sessions', page] as const,
  backups: (serverId: string) => ['admin', serverId, 'backups'] as const,
  logs: (serverId: string) => ['admin', serverId, 'logs'] as const,
  apiKeys: (serverId: string) => ['admin', serverId, 'apikeys'] as const,
  serviceAccounts: (serverId: string) =>
    ['admin', serverId, 'service-accounts'] as const,
}

// --- Listening sessions (all users, admin) ---------------------------------
// GET /api/sessions?page&itemsPerPage -> { total, numPages, page, itemsPerPage, sessions }

export interface ABSAdminSession {
  id: string
  libraryItemId: string
  displayTitle: string
  displayAuthor: string
  duration: number
  timeListening: number
  startTime: number
  currentTime: number
  startedAt: number
  updatedAt: number
  dayOfWeek: string
}

export interface ABSSessionsResponse {
  total: number
  numPages: number
  page: number
  itemsPerPage: number
  sessions: ABSAdminSession[]
}

export async function getSessions(
  t: AbsTarget,
  page = 0,
  itemsPerPage = 50
): Promise<ABSSessionsResponse> {
  const res = await absGet<Partial<ABSSessionsResponse>>(
    t,
    `/api/sessions?page=${page}&itemsPerPage=${itemsPerPage}`
  )
  return {
    total: res.total ?? 0,
    numPages: res.numPages ?? 0,
    page: res.page ?? page,
    itemsPerPage: res.itemsPerPage ?? itemsPerPage,
    sessions: res.sessions ?? [],
  }
}

// DELETE /api/sessions/:id - removes a single playback session record (admin).
export async function deleteSession(t: AbsTarget, sessionId: string): Promise<void> {
  await absDelete(t, `/api/sessions/${sessionId}`)
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
// GET /api/logger-data -> { currentDailyLogs: [...] }

export interface ABSLogEntry {
  timestamp: string
  source: string
  message: string
  level?: number
}

export async function getLogs(t: AbsTarget): Promise<{ currentDailyLogs: ABSLogEntry[] }> {
  const res = await absGet<{ currentDailyLogs?: ABSLogEntry[] }>(t, '/api/logger-data')
  return { currentDailyLogs: res.currentDailyLogs ?? [] }
}

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
  expiresIn?: number | null
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
// local grouping the admin applies. The self-hosted app persists the tagged ids
// in its Node backend, but the WebApp talks straight to ABS with no such store,
// so we keep the tag set in localStorage keyed per server. Tokens for an account
// are minted via the API-key endpoints above (filtered by userId).

const SVC_TAG_PREFIX = 'hs:service-accounts:'

function svcTagKey(serverId: string): string {
  return SVC_TAG_PREFIX + serverId
}

export function getServiceAccountIds(t: AbsTarget): string[] {
  try {
    const raw = localStorage.getItem(svcTagKey(t.serverId))
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function setServiceAccountIds(t: AbsTarget, ids: string[]): void {
  try {
    localStorage.setItem(svcTagKey(t.serverId), JSON.stringify([...new Set(ids)]))
  } catch {
    // localStorage unavailable (private mode); the grouping just won't persist.
  }
}

export function tagServiceAccount(t: AbsTarget, userId: string): string[] {
  const next = [...getServiceAccountIds(t), userId]
  setServiceAccountIds(t, next)
  return [...new Set(next)]
}

export function untagServiceAccount(t: AbsTarget, userId: string): string[] {
  const next = getServiceAccountIds(t).filter((id) => id !== userId)
  setServiceAccountIds(t, next)
  return next
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
  patch: Partial<ABSServerSettings>
): Promise<{ serverSettings: ABSServerSettings }> {
  const res = await absPatch<{ serverSettings: ABSServerSettings }>(t, '/api/settings', patch)
  return (res ?? { serverSettings: {} }) as { serverSettings: ABSServerSettings }
}

// --- Notifications (admin) --------------------------------------------------
// GET /api/notifications -> { settings, data }; PATCH /api/notifications for the
// top-level settings; PATCH /api/notifications/:id to toggle a single rule.

export interface ABSNotificationRule {
  id: string
  eventName: string
  enabled: boolean
}

export interface ABSNotificationSettings {
  appriseType: string | null
  appriseApiUrl: string | null
  notifications: ABSNotificationRule[]
  maxFailedAttempts: number
  notificationDelay: number
}

export async function getNotifications(
  t: AbsTarget
): Promise<{ settings: ABSNotificationSettings }> {
  const res = await absGet<{ settings?: Partial<ABSNotificationSettings> }>(
    t,
    '/api/notifications'
  )
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
  settings: Partial<ABSNotificationSettings>
): Promise<void> {
  await absPatch(t, '/api/notifications', settings)
}

// Toggle a single notification rule on/off. The id rides in both path and body.
export async function updateNotificationRule(
  t: AbsTarget,
  id: string,
  patch: { enabled?: boolean }
): Promise<void> {
  await absPatch(t, `/api/notifications/${id}`, { id, ...patch })
}

// --- Email (admin) ----------------------------------------------------------
// GET/PATCH /api/emails/settings; POST /api/emails/test; POST
// /api/emails/ereader-devices replaces the full device list.

export interface ABSEreaderDevice {
  name: string
  email: string
}

export interface ABSEmailSettings {
  host: string | null
  port: number | null
  secure: boolean
  rejectUnauthorized: boolean
  user: string | null
  fromAddress: string | null
  testAddress: string | null
  ereaderDevices: ABSEreaderDevice[]
}

export async function getEmailSettings(
  t: AbsTarget
): Promise<{ settings: ABSEmailSettings }> {
  const res = await absGet<{ settings?: Partial<ABSEmailSettings> }>(
    t,
    '/api/emails/settings'
  )
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
  patch: Partial<ABSEmailSettings> & { pass?: string }
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
  ereaderDevices: ABSEreaderDevice[]
): Promise<{ ereaderDevices: ABSEreaderDevice[] }> {
  const res = await absPost<{ ereaderDevices?: ABSEreaderDevice[] }>(
    t,
    '/api/emails/ereader-devices',
    { ereaderDevices }
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

function b64Param(value: string): string {
  return encodeURIComponent(btoa(unescape(encodeURIComponent(value))))
}

export async function renameTag(t: AbsTarget, tag: string, newTag: string): Promise<void> {
  await absPost(t, '/api/tags/rename', { tag, newTag })
}

export async function deleteTag(t: AbsTarget, tag: string): Promise<void> {
  await absDelete(t, `/api/tags/${b64Param(tag)}`)
}

export async function renameGenre(
  t: AbsTarget,
  genre: string,
  newGenre: string
): Promise<void> {
  await absPost(t, '/api/genres/rename', { genre, newGenre })
}

export async function deleteGenre(t: AbsTarget, genre: string): Promise<void> {
  await absDelete(t, `/api/genres/${b64Param(genre)}`)
}

// --- RSS feeds (admin) ------------------------------------------------------
// GET /api/feeds -> { feeds }; POST /api/feeds/:id/close closes one.

export interface ABSRssFeed {
  id: string
  entityType: string
  entityId: string
  feedUrl: string
  meta?: { title?: string }
}

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

export interface ABSAuthSettings {
  authActiveAuthMethods: string[]
  authLoginCustomMessage: string | null
  authOpenIDIssuerURL: string | null
  authOpenIDClientID: string | null
  authOpenIDButtonText: string | null
  authOpenIDAutoLaunch: boolean
  authOpenIDAutoRegister: boolean
}

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
  patch: Partial<ABSAuthSettings> & { authOpenIDClientSecret?: string }
): Promise<void> {
  await absPatch(t, '/api/auth-settings', patch)
}

// --- Custom metadata providers (integrations, read-only) --------------------
// GET /api/custom-metadata-providers. Built-in providers (Audible, Google,
// iTunes, Open Library) are always available and not listed here.

export interface ABSCustomProvider {
  id: string
  name: string
  url: string
}

export async function getCustomProviders(
  t: AbsTarget
): Promise<{ providers: ABSCustomProvider[] }> {
  const res = await absGet<{ providers?: ABSCustomProvider[] }>(
    t,
    '/api/custom-metadata-providers'
  )
  return { providers: res.providers ?? [] }
}

// --- Stats (insights) -------------------------------------------------------
// GET /api/stats/server (server-wide totals) and
// GET /api/libraries/:id/stats (per-library breakdown). Admin reads.

export interface ABSServerStatsBucket {
  numItems: number
  numAudioFiles: number
  totalSize: number
}

export interface ABSServerStats {
  books: ABSServerStatsBucket
  podcasts: ABSServerStatsBucket
  total: ABSServerStatsBucket
}

const EMPTY_BUCKET: ABSServerStatsBucket = { numItems: 0, numAudioFiles: 0, totalSize: 0 }

export async function getServerStats(t: AbsTarget): Promise<ABSServerStats> {
  const res = await absGet<Partial<ABSServerStats>>(t, '/api/stats/server')
  return {
    books: res.books ?? EMPTY_BUCKET,
    podcasts: res.podcasts ?? EMPTY_BUCKET,
    total: res.total ?? EMPTY_BUCKET,
  }
}

export interface ABSLibraryStatsItem {
  id: string
  title: string
  size?: number
  duration?: number
}

export interface ABSLibraryStats {
  totalItems: number
  totalAuthors: number
  totalGenres: number
  totalSize: number
  totalDuration: number
  numAudioTracks: number
  largestItems: ABSLibraryStatsItem[]
  longestItems: ABSLibraryStatsItem[]
}

export async function getLibraryStats(
  t: AbsTarget,
  libraryId: string
): Promise<ABSLibraryStats> {
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
