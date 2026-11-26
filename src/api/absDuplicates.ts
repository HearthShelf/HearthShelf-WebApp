/**
 * Finding and tidying duplicate library items (one folder ABS recorded twice).
 * The rules - which copy is kept, when a place is moved, which copies may be
 * removed - live in @hearthshelf/core lib/duplicates.ts; this file only fetches
 * and writes.
 *
 * Works against stock AudiobookShelf: nothing here needs a HearthShelf server.
 */
import { AbsError, absDelete, absGet, absPatch, absPost } from './absClient'
import type { AbsTarget } from './absLibrary'
import {
  ABS_ENDPOINTS,
  buildDuplicateIndex,
  findDuplicateItems,
  planDuplicateCarryOver,
  planDuplicateCleanup,
  type ABSBookmark,
  type ABSMediaProgress,
  type DuplicateCandidate,
  type DuplicateCleanupPlan,
  type DuplicateGroup,
  type DuplicateIndex,
  type ListenerProgress,
} from '@hearthshelf/core'

/** The raw item fields duplicate matching reads (ABS minified/expanded JSON). */
export interface DuplicateItem extends DuplicateCandidate {
  title: string
}

interface RawItem {
  id: string
  libraryId?: string
  folderId?: string
  path?: string
  ino?: string | null
  isMissing?: boolean
  isInvalid?: boolean
  addedAt?: number
  media?: { metadata?: { title?: string | null } }
}

function toDuplicateItem(r: RawItem): DuplicateItem {
  return {
    id: r.id,
    libraryId: r.libraryId ?? '',
    folderId: r.folderId ?? null,
    path: r.path ?? null,
    ino: r.ino ?? null,
    isMissing: Boolean(r.isMissing),
    isInvalid: Boolean(r.isInvalid),
    addedAt: r.addedAt ?? null,
    title: r.media?.metadata?.title ?? '',
  }
}

// At most this many title searches per probe. A library with more broken items
// than this has bigger problems; the admin cleanup reads the whole library.
const MAX_PROBE_SEARCHES = 25

/**
 * Cheap per-library check for listeners: the copy ABS later marks missing shows
 * up under the "issues" filter, and a title search finds the healthy copy at the
 * same path. Both copies being healthy (before the next scan) is caught instead
 * by lists that carry paths (see lib/duplicates.ts dedupeForServer).
 */
export async function probeDuplicateIndex(
  t: AbsTarget,
  libraryId: string,
): Promise<DuplicateIndex> {
  const issues = await absGet<{ results?: RawItem[] }>(
    t,
    `${ABS_ENDPOINTS.libraryItems(libraryId)}?filter=issues&minified=1&limit=0`,
  )
  const broken = (issues.results ?? []).map(toDuplicateItem).filter((i) => i.path || i.ino)
  if (broken.length === 0) return {}

  const titles = [...new Set(broken.map((i) => i.title.trim()).filter(Boolean))].slice(
    0,
    MAX_PROBE_SEARCHES,
  )
  const found: DuplicateItem[] = [...broken]
  for (const q of titles) {
    try {
      const res = await absGet<{ book?: Array<{ libraryItem?: RawItem }> }>(
        t,
        `${ABS_ENDPOINTS.librarySearch(libraryId)}?q=${encodeURIComponent(q)}&limit=25`,
      )
      for (const hit of res.book ?? []) {
        if (hit.libraryItem) found.push(toDuplicateItem(hit.libraryItem))
      }
    } catch {
      // One failed search only means that pair stays visible.
    }
  }
  return buildDuplicateIndex(findDuplicateItems(found))
}

/** Every item in a library with the fields matching needs (admin cleanup). */
export async function getLibraryDuplicateGroups(
  t: AbsTarget,
  libraryId: string,
): Promise<DuplicateGroup<DuplicateItem>[]> {
  const data = await absGet<{ results?: RawItem[] }>(
    t,
    `${ABS_ENDPOINTS.libraryItems(libraryId)}?minified=1&limit=0`,
  )
  return findDuplicateItems((data.results ?? []).map(toDuplicateItem))
}

interface RawMe {
  id?: string
  mediaProgress?: ABSMediaProgress[]
  bookmarks?: ABSBookmark[]
}

/** Groups (keeper + duplicate ids) rebuilt from a duplicate -> keeper map. */
export function groupsFromIndex(index: DuplicateIndex): DuplicateGroup<DuplicateCandidate>[] {
  const byKeeper = new Map<string, DuplicateCandidate[]>()
  for (const [dup, keeper] of Object.entries(index)) {
    const list = byKeeper.get(keeper) ?? []
    // libraryId is only compared between members of one group, and every pair in
    // an index came from one library, so a shared placeholder is accurate here.
    list.push({ id: dup, libraryId: '' })
    byKeeper.set(keeper, list)
  }
  return [...byKeeper].map(([keeper, duplicates]) => ({
    keeper: { id: keeper, libraryId: '' },
    duplicates,
    match: 'path' as const,
  }))
}

export interface CarryOverResult {
  movedProgress: number
  movedBookmarks: number
}

/**
 * Move the signed-in listener's place (and bookmarks) from duplicates onto the
 * copies being kept. Reads /api/me fresh, so running it twice does nothing the
 * second time: the planner only writes when the keeper has no progress or older
 * progress, and never overwrites newer listening.
 */
export async function carryOverOwnProgress(
  t: AbsTarget,
  groups: readonly DuplicateGroup<DuplicateCandidate>[],
): Promise<CarryOverResult> {
  const result: CarryOverResult = { movedProgress: 0, movedBookmarks: 0 }
  if (groups.length === 0) return result
  const me = await absGet<RawMe>(t, ABS_ENDPOINTS.me)
  const progress = me.mediaProgress ?? []
  const bookmarks = me.bookmarks ?? []
  for (const group of groups) {
    const plan = planDuplicateCarryOver(group, progress, bookmarks)
    if (plan.progress) {
      await absPatch(t, ABS_ENDPOINTS.meProgressUpdate(plan.keeperId), plan.progress.patch)
      result.movedProgress++
    }
    for (const b of plan.bookmarks) {
      await absPost(t, ABS_ENDPOINTS.meItemBookmark(plan.keeperId), b)
      result.movedBookmarks++
    }
  }
  return result
}

export interface CleanupResult {
  removed: number
  kept: DuplicateCleanupPlan['keep']
  /** One plain-language reason per entry the server refused to remove. */
  failed: string[]
}

/** Why the server refused a delete, in words an admin can act on. */
function deleteFailureReason(err: unknown): string {
  if (err instanceof AbsError) {
    // ABS checks the account's own Delete permission even for admins and root
    // (LibraryItemController.middleware -> user.canDelete), so this is the
    // likely one on a server whose admin never turned it on.
    if (err.status === 403) {
      return "Your account isn't allowed to remove books. Turn on the Delete permission for your user in the server's user settings, then try again."
    }
    return `The server answered ${err.status}${err.message ? ` (${err.message})` : ''}.`
  }
  return "Couldn't reach the server."
}

/**
 * Admin cleanup: carry the admin's own place first, then read every listener's
 * progress, then remove only the copies nobody would lose a place on.
 */
export async function cleanUpDuplicates(
  t: AbsTarget,
  groups: readonly DuplicateGroup<DuplicateItem>[],
): Promise<CleanupResult> {
  await carryOverOwnProgress(t, groups)

  const users = await absGet<{ users?: Array<{ id: string }> }>(t, ABS_ENDPOINTS.users)
  const listeners: ListenerProgress[] = []
  for (const u of users.users ?? []) {
    const detail = await absGet<{ mediaProgress?: ABSMediaProgress[] }>(t, ABS_ENDPOINTS.user(u.id))
    listeners.push({ userId: u.id, progress: detail.mediaProgress ?? [] })
  }

  const plan = planDuplicateCleanup(groups, listeners)
  let removed = 0
  const failed: string[] = []
  for (const id of plan.remove) {
    try {
      // NEVER add ?hard=1 here. The duplicate points at the SAME folder as the
      // copy being kept; a hard delete would erase the real book's files. This
      // removes only the extra database entry.
      await absDelete(t, ABS_ENDPOINTS.itemDelete(id))
      removed++
    } catch (err) {
      // Already gone (another device cleaned up first) is the goal, not a failure.
      if (err instanceof AbsError && err.status === 404) removed++
      else failed.push(deleteFailureReason(err))
    }
  }
  return { removed, kept: plan.keep, failed }
}
