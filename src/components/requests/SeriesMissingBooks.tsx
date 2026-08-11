import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/common/Icon'
import { fetchAudibleSeries, audibleKeys } from '@/api/absAudible'
import { useRmabEnabled } from '@/hooks/useRmab'
import { useFollowLookup, useFollow, useUnfollow } from '@/hooks/useSubscriptions'
import { missingSeriesBooks, isUpcoming, countdownLabel, releaseMs } from '@hearthshelf/core'
import type { AbsTarget } from '@/api/absLibrary'
import type { HSAudibleSeriesBook, OwnedSeriesBook } from '@hearthshelf/core'
import { RequestConfirmModal } from '@/components/requests/RequestConfirmModal'

interface SeriesMissingBooksProps {
  target: AbsTarget
  // ABS's series id - what identifies the series when resolving its Audible
  // roster (two distinct series can share a name).
  seriesId: string
  seriesName: string
  // Owned books (title + this-series sequence) to match against the Audible
  // roster - see missingSeriesBooks for how the match is made.
  ownedBooks: OwnedSeriesBook[]
  // Sequence number the owned list ended on; missing rows continue from here.
  startSeq: number
}

// Format a release date for a row subtitle, e.g. "Aug 19, 2026".
function releaseDateLabel(book: HSAudibleSeriesBook): string | null {
  const ms = releaseMs(book)
  if (ms === null) return null
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// One unowned roster book. An UNRELEASED book can't be obtained by anyone yet,
// so it never offers Request/Buy - it shows when it lands and offers to notify
// you instead. A released one keeps the existing request/buy behaviour.
function MissingRow({
  book,
  num,
  now,
  canRequest,
  onRequest,
}: {
  book: HSAudibleSeriesBook
  num: number
  now: number
  canRequest: boolean
  onRequest: (b: HSAudibleSeriesBook) => void
}) {
  const upcoming = book.upcoming ?? isUpcoming(book, now)
  const { bookSub } = useFollowLookup()
  const follow = useFollow()
  const unfollow = useUnfollow()
  const sub = bookSub(book.asin)
  const following = Boolean(sub)
  const busy = follow.isPending || unfollow.isPending

  const toggleFollow = () => {
    if (busy) return
    if (sub) {
      unfollow.mutate(sub.id)
      return
    }
    follow.mutate({
      kind: 'book',
      asin: book.asin,
      seriesAsin: book.seriesAsin,
      title: book.title,
      author: book.author,
      seriesTitle: book.series,
      sequence: book.sequence,
      coverArtUrl: book.coverArtUrl,
      narrator: book.narrator,
      durationMinutes: book.durationMinutes,
      releaseDate: book.releaseDate,
      publicationDatetime: book.publicationDatetime,
    })
  }

  const countdown = upcoming ? countdownLabel(book, now) : null
  const dateLabel = upcoming ? releaseDateLabel(book) : null
  const sub2 = [book.author, book.narrator].filter(Boolean).join(' · ')

  return (
    <div
      className={`sl-row sl-row-missing${upcoming ? ' sl-row-upcoming' : ''}`}
      onClick={() => (upcoming ? toggleFollow() : onRequest(book))}
    >
      <div className="sl-num">{num}</div>
      {book.coverArtUrl ? (
        <img className="sl-cover" src={book.coverArtUrl} alt="" />
      ) : (
        <div className="sl-cover" style={{ background: 'var(--c-highest)' }} />
      )}
      <div className="sl-meta">
        <div className="sl-title">{book.title}</div>
        <div className="sl-sub">{sub2}</div>
        {upcoming && dateLabel && (
          <div className="sl-release">
            <Icon name="event_upcoming" />
            Coming {dateLabel}
            {countdown ? ` · ${countdown}` : ''}
          </div>
        )}
      </div>
      {upcoming ? (
        <span
          className={`sl-missing-tag sl-follow-tag${following ? ' on' : ''}`}
          aria-disabled={busy}
        >
          <Icon name={following ? 'notifications_active' : 'notifications'} fill={following} />
          {following ? 'Following' : 'Notify me'}
        </span>
      ) : (
        <span className="sl-missing-tag">
          <Icon name={canRequest ? 'bolt' : 'shopping_cart'} fill={canRequest} />
          {canRequest ? 'Request' : 'Not in library'}
        </span>
      )}
    </div>
  )
}

// Audible entries in this series that aren't in the library, folded into the
// series list as dimmed `sl-row-missing` rows. Released books are requestable
// when the request backend is connected (otherwise a buy-on-Audible link);
// unreleased ones show their release date and offer a follow. Renders nothing
// when the series can't be resolved or nothing is missing.
export function SeriesMissingBooks({
  target,
  seriesId,
  seriesName,
  ownedBooks,
  startSeq,
}: SeriesMissingBooksProps) {
  const canRequest = useRmabEnabled()
  const [confirm, setConfirm] = useState<HSAudibleSeriesBook | null>(null)

  const { data } = useQuery({
    queryKey: audibleKeys.series(seriesId, seriesName),
    queryFn: () => fetchAudibleSeries(target, seriesId, seriesName),
    enabled: seriesName.length >= 2,
    staleTime: 30 * 60 * 1000,
    retry: false,
  })

  if (!data?.seriesAsin) return null
  const missing = missingSeriesBooks(data.books, ownedBooks)
  if (missing.length === 0) return null
  // One `now` for the whole render so every row's countdown agrees.
  const now = Date.now()

  return (
    <>
      {missing.map((b, i) => (
        <MissingRow
          key={b.asin}
          book={b}
          num={startSeq + i + 1}
          now={now}
          canRequest={canRequest}
          onRequest={setConfirm}
        />
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
