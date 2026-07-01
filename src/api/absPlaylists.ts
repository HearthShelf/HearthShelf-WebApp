/**
 * Rich playlist reads for the Playlists browse + detail pages.
 *
 * absLibrary.ts has a minimal getPlaylistsList (id + name only, for the
 * add-to-list menu). These return the items each playlist contains, which the
 * grid (cover stack) and detail page (ordered list) render. Over the ambient
 * server's ABS, like every other read.
 */
import { absGet, absDelete } from './absClient'
import type { AbsTarget } from './absLibrary'

export interface PlaylistItemRef {
  libraryItemId: string
  title: string
  author: string
}

export interface PlaylistSummary {
  id: string
  name: string
  description: string
  items: PlaylistItemRef[]
}

interface RawPlaylistItem {
  libraryItemId?: string
  libraryItem?: {
    id?: string
    media?: { metadata?: { title?: string; authorName?: string } }
  }
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
    items: (p.items ?? []).map((it) => ({
      libraryItemId: it.libraryItemId || it.libraryItem?.id || '',
      title: it.libraryItem?.media?.metadata?.title || 'Untitled',
      author: it.libraryItem?.media?.metadata?.authorName || '',
    })),
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
