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
import { absGet, absPost, absPatch, absDelete, absMediaUrl } from '@/api/absClient'
import type { AbsTarget } from '@/api/absLibrary'
import { getAbsToken } from '@/lib/absTokens'

// React Query keys for admin reads (scoped per server so a server switch
// re-fetches against the new target).
export const adminKeys = {
  users: (serverId: string) => ['admin', serverId, 'users'] as const,
  libraries: (serverId: string) => ['admin', serverId, 'libraries'] as const,
  tagNames: (serverId: string) => ['admin', serverId, 'tag-names'] as const,
  searchProviders: (serverId: string) => ['admin', serverId, 'search-providers'] as const,
}

// --- Users ------------------------------------------------------------------

export interface ABSUserPermissions {
  download: boolean
  update: boolean
  delete: boolean
  upload: boolean
  createEreader: boolean
  accessAllLibraries: boolean
  accessAllTags: boolean
  accessExplicitContent: boolean
  selectedTagsNotAccessible: boolean
  librariesAccessible: string[]
  itemTagsSelected: string[]
}

export interface ABSAdminUser {
  id: string
  username: string
  email: string | null
  type: string
  isActive: boolean
  isLocked: boolean
  lastSeen: number | null
  createdAt: number
  permissions?: ABSUserPermissions
  librariesAccessible?: string[]
}

export interface ABSUsersResponse {
  users: ABSAdminUser[]
}

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

export interface ABSLibraryFolder {
  id: string
  fullPath: string
}

export interface ABSLibrarySettings {
  coverAspectRatio: number
  disableWatcher: boolean
  autoScanCronExpression: string | null
  skipMatchingMediaWithAsin?: boolean
  skipMatchingMediaWithIsbn?: boolean
  audiobooksOnly?: boolean
  epubsAllowScriptedContent?: boolean
  hideSingleBookSeries?: boolean
  onlyShowLaterBooksInContinueSeries?: boolean
  metadataPrecedence?: string[]
  podcastSearchRegion?: string
  markAsFinishedTimeRemaining: number | null
  markAsFinishedPercentComplete: number | null
}

// The full admin library shape (richer than the browse AbsLibrary): folders,
// settings, provider and displayOrder are needed by the edit modal + reorder.
export interface ABSAdminLibrary {
  id: string
  name: string
  icon: string
  mediaType: 'book' | 'podcast'
  provider: string
  folders: ABSLibraryFolder[]
  settings: ABSLibrarySettings
  displayOrder: number
  createdAt: number
  lastUpdate: number
}

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
