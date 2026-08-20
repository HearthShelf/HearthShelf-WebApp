/**
 * Add books to a club's up-next queue without leaving the club room.
 *
 * Two ways in, because a club runs on both: search the library for one book, or
 * pick a series and queue the whole run in sequence order (a 12-book series is
 * one click, not twelve trips to the library). Both feed the same
 * enqueueClubBook call; the server no-ops a book the club already has, so
 * re-adding is safe and the dialog just reports what actually landed.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { seriesSeqFromName } from '@hearthshelf/core'
import type { HSClubBook } from '@hearthshelf/core'
import { searchLibraryFull } from '@/api/absHome'
import { getSeriesFull } from '@/api/absBrowse'
import { enqueueClubBook } from '@/api/absClubs'
import type { AbsTarget, AbsLibraryItem } from '@/api/absLibrary'
import { Cover } from '@/components/shared/Cover'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useToast } from '@/hooks/useToast'

// Series books sorted by their numeric sequence, so "#2" precedes "#10" (a
// plain string sort would not). Books with no parsable sequence keep their
// original order at the back.
function bySeriesSequence(books: AbsLibraryItem[]): AbsLibraryItem[] {
  return books
    .map((b, i) => {
      const raw = seriesSeqFromName(b.media.metadata.seriesName)
      const n = raw ? Number.parseFloat(raw) : Number.NaN
      return { b, i, n: Number.isNaN(n) ? Number.POSITIVE_INFINITY : n }
    })
    .sort((a, b) => (a.n !== b.n ? a.n - b.n : a.i - b.i))
    .map((x) => x.b)
}

export function AddClubBooksDialog({
  target,
  libraryId,
  clubId,
  clubName,
  existing,
  onClose,
  onAdded,
}: {
  target: AbsTarget
  libraryId: string
  clubId: string
  clubName: string
  /** Books already in the club (queue + history), so the dialog can say so. */
  existing: HSClubBook[]
  onClose: () => void
  onAdded: () => void
}) {
  const { show } = useToast()
  const [term, setTerm] = useState('')
  const [query, setQuery] = useState('')
  const [seriesId, setSeriesId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Debounce so typing doesn't fire a search per keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(term.trim()), 300)
    return () => window.clearTimeout(id)
  }, [term])

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  const inClub = useMemo(() => new Set(existing.map((b) => b.libraryItemId)), [existing])

  const results = useQuery({
    queryKey: ['club-add-search', target.serverId, libraryId, query],
    queryFn: () => searchLibraryFull(target, libraryId, query, 24),
    enabled: query.length > 0,
  })

  const series = useQuery({
    queryKey: ['club-add-series', target.serverId, libraryId, seriesId],
    queryFn: () => getSeriesFull(target, libraryId, seriesId!),
    enabled: Boolean(seriesId),
  })

  const add = useMutation({
    mutationFn: async (itemIds: string[]) => {
      // Sequential, not parallel: the queue's sort_order is assigned per insert
      // from the current max, so concurrent adds would race for a position and
      // scramble a series' reading order.
      let added = 0
      for (const id of itemIds) {
        await enqueueClubBook(target, clubId, id)
        added++
      }
      return added
    },
    onSuccess: (added) => {
      show(added === 1 ? 'Added to Up next.' : `Added ${added} books to Up next.`)
      onAdded()
    },
    onError: () => show('Could not add to the queue.'),
  })

  const addMany = async (ids: string[]) => {
    const fresh = ids.filter((id) => !inClub.has(id))
    if (!fresh.length) {
      show('Those books are already in this club.')
      return
    }
    setBusy(true)
    try {
      await add.mutateAsync(fresh)
    } finally {
      setBusy(false)
    }
  }

  const seriesBooks = series.data ? bySeriesSequence(series.data.books) : []
  const seriesFresh = seriesBooks.filter((b) => !inClub.has(b.id))

  return (
    <div
      className="modal-scrim open"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="modal club-add-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="club-add-title"
      >
        <header className="modal-head">
          <div className="club-invite-heading">
            <span className="eyebrow">{clubName}</span>
            <h2 id="club-add-title">Add to Up next</h2>
          </div>
          <button type="button" className="modal-nav-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>

        <div className="modal-body club-add-body">
          {seriesId ? (
            <>
              <button type="button" className="pill club-add-back" onClick={() => setSeriesId(null)}>
                <Icon name="arrow_back" /> Back to search
              </button>
              {series.isLoading ? (
                <LoadingSpinner className="py-12" label="Loading series..." />
              ) : !series.data ? (
                <div className="club-invite-empty">
                  <Icon name="error" />
                  <strong>Series not found</strong>
                  <span>It may have been removed from this library.</span>
                </div>
              ) : (
                <>
                  <div className="club-add-series-head">
                    <div>
                      <strong>{series.data.name}</strong>
                      <span>
                        {seriesBooks.length} {seriesBooks.length === 1 ? 'book' : 'books'} ·{' '}
                        {seriesFresh.length} not in this club
                      </span>
                    </div>
                    <button
                      type="button"
                      className="pill on"
                      disabled={busy || seriesFresh.length === 0}
                      onClick={() => void addMany(seriesBooks.map((b) => b.id))}
                    >
                      <Icon name="playlist_add" /> Add all {seriesFresh.length}
                    </button>
                  </div>
                  <div className="club-add-list">
                    {seriesBooks.map((book, index) => (
                      <ResultRow
                        key={book.id}
                        itemId={book.id}
                        index={index + 1}
                        title={book.media.metadata.title || 'Untitled'}
                        author={book.media.metadata.authorName}
                        already={inClub.has(book.id)}
                        busy={busy}
                        onAdd={() => void addMany([book.id])}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <label className="club-add-search">
                <Icon name="search" />
                <input
                  type="search"
                  value={term}
                  autoFocus
                  placeholder="Search this library for a book or series"
                  onChange={(event) => setTerm(event.target.value)}
                  aria-label="Search the library"
                />
              </label>

              {!query ? (
                <div className="club-invite-empty">
                  <Icon name="search" />
                  <strong>Find your next read</strong>
                  <span>Search by title, author, or series name.</span>
                </div>
              ) : results.isLoading ? (
                <LoadingSpinner className="py-12" label="Searching..." />
              ) : results.isError ? (
                <div className="club-invite-empty">
                  <Icon name="error" />
                  <strong>Search failed</strong>
                  <span>Could not reach this library.</span>
                </div>
              ) : (
                <>
                  {(results.data?.series.length ?? 0) > 0 && (
                    <div className="club-add-group">
                      <h3>Series</h3>
                      {results.data!.series.map((group) => (
                        <button
                          type="button"
                          key={group.id}
                          className="club-add-series-row"
                          onClick={() => setSeriesId(group.id)}
                        >
                          <Icon name="library_books" />
                          <span>
                            <strong>{group.name}</strong>
                            <small>Queue the whole series in order</small>
                          </span>
                          <Icon name="arrow_forward" />
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="club-add-group">
                    <h3>Books</h3>
                    {(results.data?.books.length ?? 0) === 0 ? (
                      <p className="club-add-none">No books matched that search.</p>
                    ) : (
                      <div className="club-add-list">
                        {results.data!.books.map((book) => (
                          <ResultRow
                            key={book.id}
                            itemId={book.id}
                            title={book.media.metadata.title || 'Untitled'}
                            author={book.media.metadata.authorName}
                            already={inClub.has(book.id)}
                            busy={busy}
                            onAdd={() => void addMany([book.id])}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  )
}

function ResultRow({
  itemId,
  index,
  title,
  author,
  already,
  busy,
  onAdd,
}: {
  itemId: string
  index?: number
  title: string
  author: string
  already: boolean
  busy: boolean
  onAdd: () => void
}) {
  return (
    <div className="club-add-row">
      {index != null && <span className="book-club-queue-number">{index}</span>}
      <Cover
        itemId={itemId}
        title={title}
        author={author}
        width={64}
        fs={6}
        className="book-club-queue-cover"
      />
      <span className="club-add-row-text">
        <strong>{title}</strong>
        <small>{author}</small>
      </span>
      {already ? (
        <span className="club-add-already">
          <Icon name="check" /> In club
        </span>
      ) : (
        <button type="button" className="pill" disabled={busy} onClick={onAdd}>
          <Icon name="add" /> Add
        </button>
      )}
    </div>
  )
}
