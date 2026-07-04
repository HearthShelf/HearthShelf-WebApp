import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/common/Icon'
import { fetchAudibleSeries, audibleKeys } from '@/api/absAudible'
import { useRmabEnabled } from '@/hooks/useRmab'
import { missingSeriesBooks } from '@hearthshelf/core'
import type { AbsTarget } from '@/api/absLibrary'
import type { HSAudibleSeriesBook, OwnedSeriesBook } from '@hearthshelf/core'
import { RequestConfirmModal } from '@/components/requests/RequestConfirmModal'

interface SeriesMissingBooksProps {
  target: AbsTarget
  seriesName: string
  // Owned books (title + this-series sequence) to match against the Audible
  // roster - see missingSeriesBooks for how the match is made.
  ownedBooks: OwnedSeriesBook[]
  // Sequence number the owned list ended on; missing rows continue from here.
  startSeq: number
}

// Audible entries in this series that aren't in the library, folded into the
// series list as dimmed `sl-row-missing` rows. Requestable when the request
// backend is connected, otherwise a buy-on-Audible link. Renders nothing when
// the series can't be resolved or nothing is missing.
export function SeriesMissingBooks({
  target,
  seriesName,
  ownedBooks,
  startSeq,
}: SeriesMissingBooksProps) {
  const canRequest = useRmabEnabled()
  const [confirm, setConfirm] = useState<HSAudibleSeriesBook | null>(null)

  const { data } = useQuery({
    queryKey: audibleKeys.series(seriesName),
    queryFn: () => fetchAudibleSeries(target, seriesName),
    enabled: seriesName.length >= 2,
    staleTime: 30 * 60 * 1000,
    retry: false,
  })

  if (!data?.seriesAsin) return null
  const missing = missingSeriesBooks(data.books, ownedBooks)
  if (missing.length === 0) return null

  return (
    <>
      {missing.map((b, i) => (
        <div key={b.asin} className="sl-row sl-row-missing" onClick={() => setConfirm(b)}>
          <div className="sl-num">{startSeq + i + 1}</div>
          {b.coverArtUrl ? (
            <img className="sl-cover" src={b.coverArtUrl} alt="" />
          ) : (
            <div className="sl-cover" style={{ background: 'var(--c-highest)' }} />
          )}
          <div className="sl-meta">
            <div className="sl-title">{b.title}</div>
            <div className="sl-sub">{[b.author, b.narrator].filter(Boolean).join(' · ')}</div>
          </div>
          <span className="sl-missing-tag">
            <Icon name={canRequest ? 'bolt' : 'shopping_cart'} fill={canRequest} />
            {canRequest ? 'Request' : 'Not in library'}
          </span>
        </div>
      ))}
      {confirm && (
        <RequestConfirmModal
          target={target}
          book={confirm}
          canRequest={canRequest}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  )
}
