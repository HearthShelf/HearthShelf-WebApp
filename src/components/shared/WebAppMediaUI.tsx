import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { MediaUIProvider, type MediaUI } from '@/components/shared/MediaUIContext'
import { absMediaUrl } from '@/api/absClient'
import { getItemDetail, setItemFinished, type AbsTarget } from '@/api/absLibrary'
import { usePlayer } from '@/player/PlayerProvider'

/**
 * WebApp's implementation of the shared MediaUI capabilities, scoped to one
 * connected server. Cover URLs are per-server (cross-origin + that server's
 * token); item routes are multi-server; play actually loads the book into the
 * global player and starts it.
 *
 * The HearthShelf app will mount its OWN provider (same-origin cover, /book/:id
 * routes, its own player) around the same shared components. Value is memoized
 * so it's referentially stable -> no context-driven re-renders.
 */
export function WebAppMediaUIProvider({
  target,
  children,
}: {
  target: AbsTarget
  children: ReactNode
}) {
  const navigate = useNavigate()
  const player = usePlayer()
  const qc = useQueryClient()

  const value = useMemo<MediaUI>(
    () => ({
      coverUrl: (itemId, width = 240) =>
        absMediaUrl(target, `/api/items/${encodeURIComponent(itemId)}/cover?width=${width}`),
      openItem: (itemId) => navigate(`/server/${target.serverId}/item/${itemId}`),
      // Fetch the book and start it in the global player (no navigation needed -
      // the docked mini-player surfaces it). Falls back to opening the page if
      // the fetch fails.
      playItem: async (itemId) => {
        try {
          const d = await getItemDetail(target, itemId)
          player.play({
            serverId: target.serverId,
            serverUrl: target.serverUrl,
            itemId: d.id,
            title: d.title,
            author: d.author,
            coverUrl: d.coverUrl,
            tracks: d.tracks,
            chapters: d.chapters,
            totalDurationSec: d.durationSec,
            startAtSec: d.progress?.currentTimeSec ?? 0,
            autoplay: true,
          })
        } catch {
          navigate(`/server/${target.serverId}/item/${itemId}`)
        }
      },
      markFinished: (itemId, finished) => {
        void setItemFinished(target, itemId, finished).then(() => {
          // Refresh shelves/items so progress + finished state reflect the change.
          qc.invalidateQueries({ queryKey: ['abs-shelves', target.serverId] })
          qc.invalidateQueries({ queryKey: ['abs-item', target.serverId, itemId] })
        })
      },
      // Author has a detail route now; series/narrator/genre browse routes don't
      // exist yet (those render as plain text until they do).
      authorHref: (authorId) => `/server/${target.serverId}/author/${authorId}`,
      seriesHref: () => null,
      narratorHref: () => null,
      genreHref: () => null,
    }),
    [target, navigate, player, qc]
  )

  return <MediaUIProvider value={value}>{children}</MediaUIProvider>
}
