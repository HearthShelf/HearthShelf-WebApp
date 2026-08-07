/**
 * Rich playlist reads for the Playlists browse + detail pages.
 *
 * absLibrary.ts has a minimal getPlaylistsList (id + name only, for the
 * add-to-list menu). These return the items each playlist contains, which the
 * grid (cover stack) and detail page (ordered list) render. Over the ambient
 * server's ABS, like every other read.
 */
import { resolvePlaylistEntry, type ABSPlaylistItem } from '@hearthshelf/core'
import { absGet, absDelete } from './absClient'
import type { AbsTarget } from './absLibrary'

export interface PlaylistItemRef {
  libraryItemId: string
  title: string
  /** The author for a book; the containing podcast's name for an episode. */
  author: string
  /** True when this entry addresses a single podcast episode. */
  isEpisode: boolean
  /** Present only on episode entries - identifies which episode. */
  episodeId?: string
  /** Seconds, from the episode when there is one. 0 when ABS gives none. */
  seconds: number
}

export interface PlaylistSummary {
  id: string
  name: string
  description: string
  items: PlaylistItemRef[]
}

// ABS emits TWO item shapes (Playlist.toOldJSONExpanded, Playlist.js:347):
// a book entry has only { libraryItemId, libraryItem }, while an episode entry
// adds { episodeId, episode } AND minifies libraryItem down to the podcast.
interface RawPlaylistItem {
  libraryItemId?: string
  libraryItem?: {
    id?: string
    media?: { duration?: number; metadata?: { title?: string; authorName?: string } }
  }
  episodeId?: string
  episode?: { title?: string; duration?: number | null }
}

interface RawPlaylist {
  id: string
  name?: string
  description?: string
  items?: RawPlaylistItem[]
}

function mapPlaylist(p: RawPlaylist): PlaylistSummary {
  return {
    id: p.id,
    name: p.name || 'Playlist',
    description: p.description || '',
    // Resolution lives in @hearthshelf/core so all three clients agree on
    // which shape is which - `episode` is the discriminator, NOT a non-null
    // episodeId (both keys are absent on a book entry).
    items: (p.items ?? []).map((it) => {
      const r = resolvePlaylistEntry(it as unknown as ABSPlaylistItem)
      return {
        libraryItemId: r.libraryItemId || it.libraryItem?.id || '',
        title: r.title,
        author: r.source,
        isEpisode: r.isEpisode,
        episodeId: r.episodeId,
        seconds: r.seconds,
      }
    }),
  }
}

/** Every playlist in a library, with the items each contains. */
export async function getPlaylists(t: AbsTarget, libraryId: string): Promise<PlaylistSummary[]> {
  const data = await absGet<{ results?: RawPlaylist[] }>(
    t,
    `/api/libraries/${encodeURIComponent(libraryId)}/playlists`,
  )
  return (data.results ?? []).map(mapPlaylist)
}

/** One playlist with its ordered items. */
export async function getPlaylist(t: AbsTarget, playlistId: string): Promise<PlaylistSummary> {
  const data = await absGet<RawPlaylist>(t, `/api/playlists/${encodeURIComponent(playlistId)}`)
  return mapPlaylist(data)
}

/** Delete a playlist (owner only). */
export async function deletePlaylist(t: AbsTarget, playlistId: string): Promise<void> {
  await absDelete(t, `/api/playlists/${encodeURIComponent(playlistId)}`)
}
