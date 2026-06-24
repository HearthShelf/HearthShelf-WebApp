import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { MediaUIProvider, type MediaUI } from '@/components/shared/MediaUIContext'
import { absMediaUrl } from '@/api/absClient'
import { type AbsTarget } from '@/api/absLibrary'

/**
 * WebApp's implementation of the shared MediaUI capabilities, scoped to one
 * connected server. Cover URLs are per-server (cross-origin + that server's
 * token), and item routes are multi-server (/server/:sid/item/:id) - both
 * specifics the shared components must not know about.
 *
 * The HearthShelf app will mount its OWN provider (same-origin /abs-api cover,
 * /book/:id routes) around the same shared components. Value is memoized so it's
 * referentially stable -> no context-driven re-renders.
 */
export function WebAppMediaUIProvider({
  target,
  children,
}: {
  target: AbsTarget
  children: ReactNode
}) {
  const navigate = useNavigate()

  const value = useMemo<MediaUI>(
    () => ({
      coverUrl: (itemId, width = 240) =>
        absMediaUrl(target, `/api/items/${encodeURIComponent(itemId)}/cover?width=${width}`),
      openItem: (itemId) => navigate(`/server/${target.serverId}/item/${itemId}`),
      // The WebApp player lives on the item page; "play" opens it (autoplay TBD).
      playItem: (itemId) => navigate(`/server/${target.serverId}/item/${itemId}`),
      // WebApp has no dedicated author page yet.
      authorHref: () => null,
      // markFinished intentionally omitted until the WebApp wires the mutation;
      // the shared tile hides the control when this is undefined.
    }),
    [target, navigate]
  )

  return <MediaUIProvider value={value}>{children}</MediaUIProvider>
}
