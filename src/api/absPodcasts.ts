/**
 * Typed ABS podcast reads + writes for the hosted WebApp.
 *
 * Kept in its own module (NOT absLibrary.ts) so the podcast surfaces can evolve
 * without churning the book reads. Talks to the same direct ABS client - once a
 * server is connected the SPA hits its /api/* surface straight, per-server token.
 *
 * Shapes verified against the self-hosted HearthShelf reads (audiobookshelf
 * 2.35.1 serializers):
 *   - GET /api/libraries/:id/items?limit=0           -> { results, total }   (podcast items)
 *   - GET /api/items/:id                             -> one podcast + episodes
 *   - GET /api/libraries/:id/recent-episodes?limit=N -> { episodes }
 *   - GET /api/search/podcast?term=...               -> directory results (admin)
 *   - POST /api/podcasts                             -> add a feed (admin)
 *   - GET /api/libraries/:id/episode-downloads       -> { currentDownload, queue } (admin)
 *   - GET /api/podcasts/:id/clear-queue              -> clear queued downloads (admin)
 *   - POST /api/items/:id/play/:episodeId            -> playable episode session
 */
import { absGet, absPost, absMediaUrl } from './absClient'
import type { AbsTarget, AbsTrack } from './absLibrary'

// --- Episode + show shapes --------------------------------------------------

export interface AbsPodcastEpisode {
  id: string
  title: string
  description: string | null
  publishedAt: number | null
  durationSec: number | null
  /** Present once the episode's audio file is downloaded to the server. */
  hasAudioFile: boolean
}

export interface AbsPodcast {
  id: string
  libraryId: string
  title: string
  author: string
  description: string | null
  genre: string
  feedUrl: string | null
  numEpisodes: number
  episodes: AbsPodcastEpisode[]
}

export interface AbsPodcastSummary {
  id: string
  title: string
  numEpisodes: number
}

// A recent episode carries its parent show's identity for the flat feed.
export interface AbsRecentEpisode extends AbsPodcastEpisode {
  libraryItemId: string
  podcastTitle: string
}

// --- Raw ABS shapes (only the fields we read) -------------------------------

interface RawEpisode {
  id: string
  title?: string
  description?: string | null
  subtitle?: string | null
  publishedAt?: number | null
  duration?: number | null
  audioFile?: { ino?: string } | null
}

interface RawPodcastMetadata {
  title?: string | null
  author?: string | null
  description?: string | null
  genres?: string[]
  feedUrl?: string | null
}

interface RawPodcastItem {
  id: string
  libraryId?: string
  media?: {
    metadata?: RawPodcastMetadata
    episodes?: RawEpisode[]
    numEpisodes?: number
  }
}

function mapEpisode(r: RawEpisode): AbsPodcastEpisode {
  return {
    id: r.id,
    title: r.title || 'Untitled episode',
    description: r.description ?? null,
    publishedAt: r.publishedAt ?? null,
    durationSec: r.duration ?? null,
    hasAudioFile: Boolean(r.audioFile),
  }
}

function mapPodcast(r: RawPodcastItem): AbsPodcast {
  const md = r.media?.metadata ?? {}
  const episodes = (r.media?.episodes ?? []).map(mapEpisode)
  return {
    id: r.id,
    libraryId: r.libraryId ?? '',
    title: md.title || 'Untitled',
    author: md.author || '',
    description: md.description ?? null,
    genre: md.genres?.[0] || '',
    feedUrl: md.feedUrl ?? null,
    numEpisodes: r.media?.numEpisodes ?? episodes.length,
    episodes,
  }
}

// --- Reads ------------------------------------------------------------------

/** The shows in a podcast-type library (the library grid). */
export async function getPodcasts(t: AbsTarget, libraryId: string): Promise<AbsPodcast[]> {
  const data = await absGet<{ results?: RawPodcastItem[] }>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/items?limit=0`
  )
  return (data.results ?? []).map(mapPodcast)
}

/** One show with its full episode list (the detail page). */
export async function getPodcast(t: AbsTarget, itemId: string): Promise<AbsPodcast> {
  const data = await absGet<RawPodcastItem>(
    t,
    `/api/items/${encodeURIComponent(itemId)}?expanded=1`
  )
  return mapPodcast(data)
}

interface RawRecentEpisode extends RawEpisode {
  libraryItemId?: string
  podcast?: { metadata?: { title?: string | null } } | { title?: string | null }
}

function recentPodcastTitle(r: RawRecentEpisode): string {
  const p = r.podcast
  if (!p) return 'Podcast'
  // ABS has shipped both a flat { title } and a nested { metadata: { title } }.
  if ('metadata' in p && p.metadata) return p.metadata.title || 'Podcast'
  if ('title' in p) return p.title || 'Podcast'
  return 'Podcast'
}

/** A flat, reverse-chronological feed of recent episodes across the library. */
export async function getLatestEpisodes(
  t: AbsTarget,
  libraryId: string,
  limit = 50
): Promise<AbsRecentEpisode[]> {
  const data = await absGet<{ episodes?: RawRecentEpisode[] }>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/recent-episodes?limit=${limit}`
  )
  return (data.episodes ?? []).map((r) => ({
    ...mapEpisode(r),
    libraryItemId: r.libraryItemId ?? '',
    podcastTitle: recentPodcastTitle(r),
  }))
}

// --- Directory search + add (admin) -----------------------------------------

export interface PodcastDirectoryResult {
  id: number
  title: string
  artistName: string
  description: string | null
  cover: string | null
  feedUrl: string
  pageUrl: string | null
  trackCount: number
  genres: string[]
  explicit: boolean
}

interface RawDirectoryResult {
  id?: number
  title?: string
  artistName?: string
  description?: string | null
  cover?: string | null
  feedUrl?: string
  pageUrl?: string | null
  trackCount?: number
  genres?: string[]
  explicit?: boolean
}

/** Search the iTunes podcast directory (library-independent). Admin. */
export async function searchPodcasts(
  t: AbsTarget,
  term: string
): Promise<PodcastDirectoryResult[]> {
  const q = term.trim()
  if (!q) return []
  const data = await absGet<RawDirectoryResult[]>(
    t,
    `/api/search/podcast?term=${encodeURIComponent(q)}`
  )
  return (data ?? []).map((r) => ({
    id: r.id ?? 0,
    title: r.title || 'Untitled',
    artistName: r.artistName || '',
    description: r.description ?? null,
    cover: r.cover ?? null,
    feedUrl: r.feedUrl || '',
    pageUrl: r.pageUrl ?? null,
    trackCount: r.trackCount ?? 0,
    genres: r.genres ?? [],
    explicit: Boolean(r.explicit),
  }))
}

/**
 * Add a podcast feed to a library. ABS first fetches the feed (POST
 * /api/podcasts/feed) to resolve its metadata, then creates the item (POST
 * /api/podcasts) with a folder under the library. Admin.
 */
export async function addPodcast(
  t: AbsTarget,
  libraryId: string,
  feedUrl: string,
  opts: { folderId?: string; autoDownloadEpisodes?: boolean } = {}
): Promise<void> {
  const feed = await absPost<{ podcast?: { metadata?: RawPodcastMetadata } }>(
    t,
    '/api/podcasts/feed',
    { rssFeed: feedUrl }
  )
  const md = feed?.podcast?.metadata ?? {}
  await absPost(t, '/api/podcasts', {
    libraryId,
    folderId: opts.folderId,
    media: { metadata: md },
    autoDownloadEpisodes: opts.autoDownloadEpisodes ?? false,
  })
}

// --- Download queue (admin) -------------------------------------------------

export interface EpisodeDownload {
  id: string
  episodeDisplayTitle: string | null
  podcastTitle: string | null
  libraryItemId: string
  publishedAt: number | null
}

export interface DownloadQueue {
  currentDownload: EpisodeDownload | null
  queue: EpisodeDownload[]
}

interface RawDownload {
  id?: string
  episodeDisplayTitle?: string | null
  podcastTitle?: string | null
  libraryItemId?: string
  publishedAt?: number | null
}

function mapDownload(r: RawDownload): EpisodeDownload {
  return {
    id: r.id ?? '',
    episodeDisplayTitle: r.episodeDisplayTitle ?? null,
    podcastTitle: r.podcastTitle ?? null,
    libraryItemId: r.libraryItemId ?? '',
    publishedAt: r.publishedAt ?? null,
  }
}

/** Live podcast download-queue status for a library. Admin. */
export async function getDownloadQueue(
  t: AbsTarget,
  libraryId: string
): Promise<DownloadQueue> {
  const data = await absGet<{
    currentDownload?: RawDownload | null
    queue?: RawDownload[]
  }>(t, `/api/libraries/${encodeURIComponent(libraryId)}/episode-downloads`)
  return {
    currentDownload: data.currentDownload ? mapDownload(data.currentDownload) : null,
    queue: (data.queue ?? []).map(mapDownload),
  }
}

/** Clear the queued (not yet started) downloads for one podcast item. Admin. */
export async function clearDownloadQueue(t: AbsTarget, podcastItemId: string): Promise<void> {
  await absGet(t, `/api/podcasts/${encodeURIComponent(podcastItemId)}/clear-queue`)
}

// --- Playable episode session -----------------------------------------------

interface RawPlaySession {
  id?: string
  duration?: number
  currentTime?: number
  audioTracks?: Array<{
    index: number
    contentUrl: string
    startOffset?: number
    duration?: number
  }>
}

const PLAY_DEVICE = { deviceId: 'hearthshelf-web', clientName: 'HearthShelf', clientVersion: '0.1.0' }
const PLAY_MIME = ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/flac', 'audio/ogg']

export interface PlayableEpisode {
  /** One track (the episode's single audio file), offset 0. */
  tracks: AbsTrack[]
  totalDurationSec: number
  /** Server-side resume position, if any. */
  currentTimeSec: number
  /** Open play session id (sync it to accrue stats). */
  playSessionId: string | null
}

/**
 * Open a playback session for one episode (POST /api/items/:id/play/:episodeId).
 * This is the only ABS endpoint that yields a streamable, tokenized track URL for
 * an episode. A podcast episode is a single audio file, so the session returns
 * one audio track at offset 0 - we shape it into the global player's AbsTrack[].
 */
export async function getPlayableEpisode(
  t: AbsTarget,
  itemId: string,
  episodeId: string
): Promise<PlayableEpisode> {
  const session = await absPost<RawPlaySession>(
    t,
    `/api/items/${encodeURIComponent(itemId)}/play/${encodeURIComponent(episodeId)}`,
    { deviceInfo: PLAY_DEVICE, supportedMimeTypes: PLAY_MIME }
  )
  const raw = session?.audioTracks ?? []
  const tracks: AbsTrack[] = raw.map((tr) => ({
    ino: String(tr.index),
    index: tr.index,
    startOffsetSec: tr.startOffset ?? 0,
    durationSec: tr.duration ?? 0,
    url: absMediaUrl(t, tr.contentUrl),
  }))
  const totalDurationSec =
    session?.duration ?? tracks.reduce((s, tr) => s + tr.durationSec, 0)
  return {
    tracks,
    totalDurationSec,
    currentTimeSec: session?.currentTime ?? 0,
    playSessionId: session?.id ?? null,
  }
}
