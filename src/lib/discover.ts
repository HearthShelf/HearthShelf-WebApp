/**
 * Discover shelf generators. Builds ambient "more from your shelf" rows entirely
 * from the user's own library + listening history - no backend, no AI, no RMAB.
 *
 * Ported from the HearthShelf server app (src/lib/discover.ts + the profile
 * helpers it borrowed from questgiver.ts), adapted to the WebApp's AbsLibraryItem
 * and MediaProgress shapes. Discover degrades to these deterministic base shelves
 * whenever the /hs/discover backend is unavailable.
 */
import type { AbsLibraryItem } from '@/api/absLibrary'
import type { MediaProgress } from '@/api/absLibrary'

const MIN_SHELF = 3 // drop a row with fewer than this many books
const MAX_SHELVES = 6
const ROW_CAP = 18 // books per row

// ABS often stores genres as comma-joined multi-genre strings; split into clean
// tokens so weighting works on real buckets, not near-duplicate combos.
function genresOf(item: AbsLibraryItem): string[] {
  const raw = item.media.metadata.genres ?? []
  const tokens = raw
    .flatMap((g) => g.split(','))
    .map((g) => g.trim())
    .filter(Boolean)
  return tokens.length ? [...new Set(tokens)] : []
}

function authorOf(item: AbsLibraryItem): string {
  return (item.media.metadata.authorName ?? '').trim()
}
function narratorOf(item: AbsLibraryItem): string {
  return (item.media.metadata.narratorName ?? '').trim()
}
function seriesOf(item: AbsLibraryItem): string {
  return (item.media.metadata.seriesName ?? '').trim()
}
function titleOf(item: AbsLibraryItem): string {
  return item.media.metadata.title ?? 'Untitled'
}

interface ItemState {
  item: AbsLibraryItem
  finished: boolean
  started: boolean
  unstarted: boolean
}

function statesOf(
  items: AbsLibraryItem[],
  progressById: Map<string, MediaProgress>
): ItemState[] {
  return items.map((item) => {
    const p = progressById.get(item.id)
    const finished = p?.isFinished ?? false
    const started = !finished && (p?.progress ?? 0) > 0
    return { item, finished, started, unstarted: !finished && !started }
  })
}

// Authors/narrators the listener finishes most (>= 2 finished).
function topBy(states: ItemState[], key: (i: AbsLibraryItem) => string): string[] {
  const counts = new Map<string, number>()
  for (const s of states) {
    if (!s.finished) continue
    const k = key(s.item).trim()
    if (!k) continue
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
}

// --- Per-genre taste profile (the bits Discover needs from questgiver) -------

export interface GenreStat {
  genre: string
  finished: number
  started: number
  owned: number
  hours: number
  score: number
  weight: number
}

export interface DiscoverProfile {
  stat: Record<string, GenreStat>
  listened: GenreStat[]
  dominant: string | null
  cold: GenreStat | null
  totalFin: number
}

function hoursOf(item: AbsLibraryItem): number {
  const dur = item.media.duration ?? 0
  return dur ? Math.round((dur / 3600) * 10) / 10 : 0
}

// Per-genre listening profile. "listened" = finished or in-progress; finished
// weighted heavier. Weights normalize to 0-10.
export function buildProfile(
  items: AbsLibraryItem[],
  progressById: Map<string, MediaProgress>
): DiscoverProfile {
  const stat: Record<string, GenreStat> = {}
  const bump = (g: string, k: 'finished' | 'started' | 'owned', h = 0) => {
    stat[g] = stat[g] || {
      genre: g,
      finished: 0,
      started: 0,
      owned: 0,
      hours: 0,
      score: 0,
      weight: 0,
    }
    stat[g][k]++
    if (h) stat[g].hours += h
  }
  for (const item of items) {
    const p = progressById.get(item.id)
    const finished = p?.isFinished ?? false
    const progress = p?.progress ?? 0
    const gs = genresOf(item)
    const buckets = gs.length ? gs : ['Unsorted']
    const hours = hoursOf(item)
    const share = hours / buckets.length
    for (const g of buckets) {
      bump(g, 'owned')
      if (finished) bump(g, 'finished', share)
      else if (progress > 0) bump(g, 'started', share * progress)
    }
  }
  const listened = Object.values(stat)
  listened.forEach((x) => {
    x.score = x.finished * 2 + x.started
  })
  const maxScore = Math.max(1, ...listened.map((x) => x.score))
  listened.forEach((x) => {
    x.weight =
      x.score > 0
        ? Math.max(2, Math.round((x.score / maxScore) * 10))
        : x.owned > 0
          ? 1
          : 0
  })
  listened.sort((a, b) => b.score - a.score)
  const played = listened.filter((x) => x.score > 0)
  const dominant = played[0]?.genre ?? null
  const cold =
    listened
      .filter((x) => x.genre !== dominant && x.owned >= 2 && x.score <= 1)
      .sort((a, b) => b.owned - a.owned)[0] ?? null
  const totalFin = listened.reduce((n, x) => n + x.finished, 0)
  return { stat, listened, dominant, cold, totalFin }
}

// --- Discover shelves --------------------------------------------------------

export interface DiscoverShelf {
  id: string
  label: string
  icon: string
  items: AbsLibraryItem[]
}

// A compact candidate the monthly AI shelf chooses from (posted to the backend).
export interface DiscoverCandidate {
  id: string
  title: string
  author: string
  genre: string
  hours: number
}

// History summary the client posts so the server holds no ABS data of its own.
export interface DiscoverSummary {
  totalFinished: number
  dominant: string | null
  topAuthors: string[]
  topNarrators: string[]
  recentFinishes: string[]
}

// Unstarted owned books as AI-shelf candidates.
export function discoverCandidates(
  items: AbsLibraryItem[],
  progressById: Map<string, MediaProgress>
): DiscoverCandidate[] {
  return statesOf(items, progressById)
    .filter((s) => s.unstarted)
    .map((s) => ({
      id: s.item.id,
      title: titleOf(s.item),
      author: authorOf(s.item),
      genre: genresOf(s.item)[0] ?? 'Unsorted',
      hours: hoursOf(s.item),
    }))
}

// History summary for the monthly AI shelf prompt.
export function buildDiscoverSummary(
  items: AbsLibraryItem[],
  progressById: Map<string, MediaProgress>
): DiscoverSummary {
  const profile = buildProfile(items, progressById)
  const states = statesOf(items, progressById)
  const recentFinishes = states
    .filter((s) => s.finished)
    .map((s) => titleOf(s.item))
    .slice(0, 6)
  return {
    totalFinished: profile.totalFin,
    dominant: profile.dominant,
    topAuthors: topBy(states, authorOf).slice(0, 3),
    topNarrators: topBy(states, narratorOf).slice(0, 3),
    recentFinishes,
  }
}

// Build all Discover shelves in priority order, de-duping books across rows.
export function buildDiscoverShelves(
  items: AbsLibraryItem[],
  progressById: Map<string, MediaProgress>
): { shelves: DiscoverShelf[]; profile: DiscoverProfile } {
  const profile = buildProfile(items, progressById)
  const states = statesOf(items, progressById)
  const unstarted = states.filter((s) => s.unstarted).map((s) => s.item)

  const used = new Set<string>()
  const shelves: DiscoverShelf[] = []
  const take = (pool: AbsLibraryItem[]): AbsLibraryItem[] => {
    const out: AbsLibraryItem[] = []
    for (const it of pool) {
      if (used.has(it.id)) continue
      out.push(it)
      if (out.length >= ROW_CAP) break
    }
    return out
  }
  const push = (shelf: Omit<DiscoverShelf, 'items'>, pool: AbsLibraryItem[]) => {
    if (shelves.length >= MAX_SHELVES) return
    const picked = take(pool)
    if (picked.length < MIN_SHELF) return
    picked.forEach((it) => used.add(it.id))
    shelves.push({ ...shelf, items: picked })
  }

  // 0. "Recommended for you" - one shelf ranked across ALL signals at once.
  const authorAff = new Map<string, number>()
  const narratorAff = new Map<string, number>()
  for (const s of states) {
    if (!s.finished && !s.started) continue
    const a = authorOf(s.item)
    const n = narratorOf(s.item)
    if (a) authorAff.set(a, (authorAff.get(a) ?? 0) + (s.finished ? 2 : 1))
    if (n) narratorAff.set(n, (narratorAff.get(n) ?? 0) + (s.finished ? 2 : 1))
  }
  const touchedSeriesNames = new Set<string>()
  for (const s of states) {
    const name = seriesOf(s.item)
    if (name && (s.finished || s.started)) touchedSeriesNames.add(name)
  }
  const scoreItem = (it: AbsLibraryItem): number => {
    let score = 0
    for (const g of genresOf(it)) score += profile.stat[g]?.weight ?? 0
    score += (authorAff.get(authorOf(it)) ?? 0) * 2
    score += narratorAff.get(narratorOf(it)) ?? 0
    if (touchedSeriesNames.has(seriesOf(it))) score += 4
    return score
  }
  const ranked = [...unstarted]
    .map((it) => ({ it, s: scoreItem(it) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.it)
  push({ id: 'recommended', label: 'Recommended for you', icon: 'recommend' }, ranked)

  // 1. Top genre(s).
  const topGenres = profile.listened
    .filter((g) => g.score > 0)
    .slice(0, 2)
    .map((g) => g.genre)
  for (const g of topGenres) {
    push(
      { id: 'genre-' + g, label: `Because you love ${g}`, icon: 'local_fire_department' },
      unstarted.filter((it) => genresOf(it).includes(g))
    )
  }

  // 2. More from authors the listener finishes.
  for (const author of topBy(states, authorOf).slice(0, 2)) {
    push(
      { id: 'author-' + author, label: `More from ${author}`, icon: 'person' },
      unstarted.filter((it) => authorOf(it) === author)
    )
  }

  // 3. Narrators the listener returns to.
  const topNarrator = topBy(states, narratorOf)[0]
  if (topNarrator) {
    push(
      { id: 'narrator-' + topNarrator, label: `Narrated by ${topNarrator}`, icon: 'record_voice_over' },
      unstarted.filter((it) => narratorOf(it) === topNarrator)
    )
  }

  // 4. Finish the series.
  const touchedSeries = new Set<string>()
  for (const s of states) {
    const name = seriesOf(s.item)
    if (name && (s.finished || s.started)) touchedSeries.add(name)
  }
  const seriesGaps = unstarted.filter((it) => {
    const name = seriesOf(it)
    return name !== '' && touchedSeries.has(name)
  })
  push({ id: 'series-next', label: 'Finish the series', icon: 'auto_stories' }, seriesGaps)

  // 5. Revisit a cold genre.
  if (profile.cold) {
    const coldGenre = profile.cold.genre
    push(
      { id: 'cold-' + coldGenre, label: `Revisit ${coldGenre}`, icon: 'swap_horiz' },
      unstarted.filter((it) => genresOf(it).includes(coldGenre))
    )
  }

  // 6. Fallback - unstarted owned books, most recently added first.
  push(
    { id: 'recent', label: 'Back to your library', icon: 'library_books' },
    [...unstarted].sort((a, b) => b.addedAt - a.addedAt)
  )

  return { shelves, profile }
}
