import { useSearchParams } from 'react-router-dom'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { useLibrarySearch, useDebounced } from '@/hooks/useLibrary'
import { ItemGrid } from '@/components/ItemGrid'
import { Icon } from '@/components/common/Icon'

/**
 * Library search. Reads ?q= from the URL, debounces it, and searches the active
 * library through useLibrarySearch. Renders results via the shared ItemGrid.
 * The page renders inside <ActiveServerMediaUI>, so the active server is already
 * connected by the time we render.
 */
export function SearchPage() {
  const [params] = useSearchParams()
  const { target } = useActiveServer()
  const { activeId } = useActiveLibrary()

  const q = (params.get('q') ?? '').trim()
  const debouncedQ = useDebounced(q, 300)

  const enabled = Boolean(target) && Boolean(activeId) && debouncedQ.length >= 2
  const { data, isLoading, isError } = useLibrarySearch(
    target ?? { serverId: '', serverUrl: '' },
    activeId ?? undefined,
    debouncedQ,
    enabled
  )

  const items = data ?? []
  const hasResults = items.length > 0

  if (!target) return null

  return (
    <div className="page fade-in" style={{ paddingTop: 24 }}>
      <div className="page-head">
        <div className="eyebrow">Search results</div>
        <h1 className="title-xl">{q ? `"${q}"` : 'Search'}</h1>
      </div>

      {q.length < 2 && (
        <p className="page-sub">Type at least two characters to search.</p>
      )}

      {q.length >= 2 && isLoading && <p className="page-sub">Searching...</p>}

      {q.length >= 2 && isError && (
        <div className="empty-state">
          <Icon name="error" />
          <h3>Search failed</h3>
          <p>Something went wrong. Try a different query.</p>
        </div>
      )}

      {q.length >= 2 && data && !hasResults && (
        <div className="sg-empty">
          <Icon name="search_off" />
          <p>No results for "{q}"</p>
        </div>
      )}

      {hasResults && (
        <div className="search-group">
          <div className="section-head">
            <Icon name="auto_stories" />
            <h2>In your library · {items.length}</h2>
          </div>
          <ItemGrid items={items} />
        </div>
      )}
    </div>
  )
}
