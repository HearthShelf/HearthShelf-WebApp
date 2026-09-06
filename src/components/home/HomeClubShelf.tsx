/**
 * Active book clubs on Home. Shows the clubs the reader is in as a compact row,
 * each opening its club room. Renders nothing when the reader has no clubs or
 * the server has clubs turned off - so it's safe to always mount.
 */
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getClubs, clubsKeys } from '@/api/absClubs'
import { useActiveServer } from '@/hooks/useActiveServer'
import { Cover } from '@/components/shared/Cover'
import { SectionHead } from '@/components/common/SectionHead'
import { BandError } from '@/components/common/BandError'

export function HomeClubShelf() {
  const navigate = useNavigate()
  const { target } = useActiveServer()

  const { data, isError, refetch } = useQuery({
    // No libraryItemId: the server returns just the clubs this reader is in.
    queryKey: clubsKeys.list(target?.serverId ?? '', ''),
    queryFn: () => getClubs(target!),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })

  // A failed fetch and "no clubs" used to render identically. Only stay silent
  // when the server actually answered.
  if (isError) return <BandError label="Your book clubs" onRetry={() => refetch()} />

  const clubs = data?.enabled ? data.mine : []
  if (clubs.length === 0) return null

  return (
    <div className="section">
      <SectionHead icon="groups" title="Your book clubs" />
      <div className="shelf-row">
        {clubs.map((c) => (
          <button
            key={c.id}
            type="button"
            className="club-tile"
            onClick={() => navigate(`/club/${encodeURIComponent(c.id)}`)}
          >
            <Cover
              itemId={c.currentBook?.libraryItemId ?? ''}
              title={c.currentBook?.title ?? c.name}
              fs={11}
              style={{ width: '100%', aspectRatio: '1', borderRadius: 12 }}
            />
            <div className="club-tile-n">{c.name}</div>
            <div className="club-tile-b">{c.currentBook?.title || 'No current book'}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
