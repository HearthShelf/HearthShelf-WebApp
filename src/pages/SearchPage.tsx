import { useNavigate, useSearchParams } from 'react-router-dom'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { useLibrarySearchFull, useDebounced } from '@/hooks/useLibrary'
import { useMediaProgress } from '@/hooks/useMediaProgress'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { useToast } from '@/hooks/useToast'
import { tintFor } from '@/components/shared/Cover'
import { Icon } from '@/components/common/Icon'
import { BookTile } from '@/components/library/BookTile'
import { SeriesCard } from '@/components/library/SeriesCard'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'
import { searchSeriesToCard } from '@/api/absHome'

// Two-letter monogram for an author avatar, from the first + last name parts.
function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (
      (parts[0].match(/[A-Za-z]/)?.[0] ?? '') +
      (parts[parts.length - 1].match(/[A-Za-z]/)?.[0] ?? '')
    ).toUpperCase()
  }
  return (name.match(/[A-Za-z]/g) ?? []).slice(0, 2).join('').toUpperCase()
}

/**
 * Library search. Reads ?q= from the URL (the AppBar navigates here), debounces
 * it, and renders ABS's multi-section results: books, series, authors, and
 * narrators. The page renders inside <ActiveServerMediaUI>, so the active server
 * is already connected; covers/play/open + author/narrator routes come from the
 * ambient MediaUI provider.
 */
export function SearchPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const ui = useMediaUI()
  const { target } = useActiveServer()
  const { activeId } = useActiveLibrary()
  const progressById = useMediaProgress()
  const { toast, show } = useToast()

  const q = (params.get('q') ?? '').trim()
  const debouncedQ = useDebounced(q, 300)
  const enabled = Boolean(target) && Boolean(activeId) && debouncedQ.length >= 2

  const { data, isLoading, isError, refetch } = useLibrarySearchFull(
    target ?? { serverId: '', serverUrl: '' },
    activeId ?? undefined,
    debouncedQ,
    enabled
  )

  if (!target) return null

  const books = data?.books ?? []
  const series = data?.series ?? []
  const authors = data?.authors ?? []
  const narrators = data?.narrators ?? []
  const hasResults =
    books.length > 0 || series.length > 0 || authors.length > 0 || narrators.length > 0

  return (
    <div className="page fade-in" style={{ paddingTop: 24 }}>
      <div className="page-head">
        <div className="eyebrow">Search results</div>
        <h1 className="title-xl">{q ? `"${q}"` : 'Search'}</h1>
      </div>

      {q.length < 2 && (
        <p className="page-sub">Type at least two characters to search.</p>
      )}

      {q.length >= 2 && isLoading && <LoadingSpinner className="py-12" label="Searching..." />}
      {q.length >= 2 && isError && <ErrorState message="Search failed." onRetry={refetch} />}

      {data && !hasResults && q.length >= 2 && (
        <div className="sg-empty">
          <Icon name="search_off" />
          <p>No results for "{q}"</p>
        </div>
      )}

      {books.length > 0 && (
        <div className="search-group">
          <div className="section-head">
            <Icon name="auto_stories" />
            <h2>In your library · {books.length}</h2>
          </div>
          <div className="lib-grid">
            {books.map((item) => {
              const p = progressById.get(item.id)
              return (
                <BookTile
                  key={item.id}
                  item={item}
                  progress={p?.progress ?? 0}
                  finished={p?.isFinished}
                  onToast={show}
                />
              )
            })}
          </div>
        </div>
      )}

      {series.length > 0 && (
        <div className="search-group">
          <div className="section-head">
            <Icon name="format_list_numbered" />
            <h2>Series · {series.length}</h2>
          </div>
          <div className="series-grid">
            {series.map((s) => (
              <SeriesCard key={s.id} series={searchSeriesToCard(s)} />
            ))}
          </div>
        </div>
      )}

      {authors.length > 0 && (
        <div className="search-group">
          <div className="section-head">
            <Icon name="person" />
            <h2>Authors · {authors.length}</h2>
          </div>
          <div className="author-grid">
            {authors.map((a) => {
              const cv = tintFor(a.name)
              const href = ui.authorHref?.(a.id) ?? `/author/${a.id}`
              return (
                <div
                  className="author-card"
                  key={a.id}
                  data-cv={cv}
                  onClick={() => navigate(href)}
                >
                  <div
                    className="author-av"
                    style={{
                      background: `linear-gradient(150deg, ${cv}, color-mix(in oklab, ${cv} 45%, #000))`,
                    }}
                  >
                    {initialsOf(a.name)}
                  </div>
                  <div className="author-name">{a.name}</div>
                  <div className="author-books">
                    {a.numBooks} {a.numBooks === 1 ? 'book' : 'books'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {narrators.length > 0 && (
        <div className="search-group">
          <div className="section-head">
            <Icon name="mic" />
            <h2>Narrators · {narrators.length}</h2>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s3)' }}>
            {narrators.map((n) => {
              const href = ui.narratorHref?.(n.name)
              return (
                <button
                  className="chip"
                  key={n.name}
                  type="button"
                  onClick={() => href && navigate(href)}
                  style={{ cursor: href ? 'pointer' : 'default' }}
                >
                  <Icon name="mic" fill style={{ fontSize: 14 }} /> {n.name}
                  <span style={{ color: 'var(--text-faint)', marginLeft: 4 }}>
                    {n.numBooks} {n.numBooks === 1 ? 'book' : 'books'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
    </div>
  )
}
