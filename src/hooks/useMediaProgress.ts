import { useQuery } from '@tanstack/react-query'
import { getMediaProgress, type MediaProgress } from '@/api/absLibrary'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useConnectActiveServer } from '@/hooks/useConnectActiveServer'

/**
 * A lookup of the user's per-item listening progress, keyed by libraryItemId,
 * for the active server. Backed by /api/me (mediaProgress[]); shared across
 * tiles, shelves, and detail pages. Refreshed when a session syncs
 * (mark-finished / save-progress invalidate the same key).
 */
export function useMediaProgress(): Map<string, MediaProgress> {
  const { target } = useActiveServer()
  const { connected } = useConnectActiveServer()

  const { data } = useQuery({
    queryKey: ['abs-media-progress', target?.serverId],
    queryFn: () => getMediaProgress(target as NonNullable<typeof target>),
    enabled: Boolean(target) && connected,
    staleTime: 60 * 1000,
  })

  const byId = new Map<string, MediaProgress>()
  for (const p of data ?? []) byId.set(p.libraryItemId, p)
  return byId
}
