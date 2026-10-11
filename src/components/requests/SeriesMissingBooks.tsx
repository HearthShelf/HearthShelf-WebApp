import { Icon } from '@/components/common/Icon'
import { useIgnoreBook } from '@/hooks/useIgnoredBooks'
import { useFollowLookup, useFollow, useUnfollow } from '@/hooks/useSubscriptions'
import { isUpcoming, countdownLabel, releaseMs } from '@hearthshelf/core'
import type { HSAudibleSeriesBook } from '@hearthshelf/core'
import { SeqNum } from '@/components/shared/SeqNum'
import { seqLabel } from '@/lib/seriesOrder'

// The first missing row carries this id so the series summary's "N not in
// library" count can jump straight to it.
export const SERIES_MISSING_ANCHOR = 'series-missing'

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

// One unowned roster book, as a dimmed row in its place in the series list. An
// UNRELEASED book can't be obtained by anyone yet, so it never offers
// Request/Buy - it shows when it lands and offers to notify you instead. A
// released one keeps the existing request/buy behaviour.
export function MissingRow({
  id,
  book,
  num,
  now,
  canRequest,
  onRequest,
}: {
  id?: string
  book: HSAudibleSeriesBook
  // List position, shown when the roster entry has no series number.
  num: number
  now: number
  canRequest: boolean
  onRequest: (b: HSAudibleSeriesBook) => void
}) {
  const upcoming = book.upcoming ?? isUpcoming(book, now)
  const { ignore, busy: ignoreBusy } = useIgnoreBook()
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
      id={id}
      className={`sl-row sl-row-missing${upcoming ? ' sl-row-upcoming' : ''}`}
      onClick={() => (upcoming ? toggleFollow() : onRequest(book))}
    >
      <SeqNum label={seqLabel(book.sequence) || String(num)} />
      {book.coverArtUrl ? (
        <img className="sl-cover" src={book.coverArtUrl} alt="" loading="lazy" />
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
      {/* "Never coming" escape hatch: Audible lists ebook-only side stories and
          print editions as series books, and they'd otherwise count against the
          series forever. */}
      <button
        className="sl-ignore-btn"
        title="Ignore this book - it won't count toward the series"
        disabled={ignoreBusy}
        onClick={(e) => {
          e.stopPropagation()
          if (book.asin) ignore.mutate(book.asin)
        }}
      >
        <Icon name="visibility_off" />
      </button>
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
