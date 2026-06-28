import { useState } from 'react'
import { Loader2, Link2, AlertCircle, Search, X } from 'lucide-react'
import {
  useConnect,
  useLibraries,
  useLibraryItems,
  useLibrarySearch,
  useShelves,
  useDebounced,
} from '@/hooks/useLibrary'
import { type AbsTarget } from '@/api/absLibrary'
import { Button } from '@/components/ui/Button'
import { ItemGrid } from '@/components/ItemGrid'
import { ShelfRow } from '@/components/ShelfRow'
import { WebAppMediaUIProvider } from '@/components/shared/WebAppMediaUI'
import { cn } from '@/lib/cn'

// Home shelves we surface, in display order.
const HOME_SHELVES = ['continue-listening', 'recently-added']

/**
 * The library surface for one connected server. Connection is now silent: landing
 * here auto-connects (a plain grant -> /hs/hosted/connect fetch, no popup), so we
 * just show a brief connecting state, then the library. On failure we offer a
 * retry. Once connected it shows the server's libraries as tabs and a paginated
 * grid of items with covers, fetched directly from that server's ABS.
 */
export function ServerLibrary({ target }: { target: AbsTarget }) {
  const { state, error, connect, connected } = useConnect(target)

  if (!connected) {
    if (state === 'error') {
      return (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <AlertCircle className="mx-auto text-destructive" size={28} />
          <p className="mt-3 font-medium text-card-foreground">Couldn&apos;t connect to this server</p>
          <p className="t-muted mx-auto mt-1 max-w-sm text-[13px]">
            {error?.includes('not_paired')
              ? 'This server isn&apos;t finished connecting to HearthShelf yet.'
              : 'We could not sign you in to this server. Please try again.'}
          </p>
          <div className="mt-5">
            <Button onClick={connect}>
              <Link2 size={16} />
              Try again
            </Button>
          </div>
        </div>
      )
    }
    // idle (briefly, before the mount effect fires) or connecting.
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-12 text-muted-foreground">
        <Loader2 className="animate-spin" size={18} />
        <span className="t-body">Connecting to your library...</span>
      </div>
    )
  }

  return <ConnectedLibrary target={target} />
}

function ConnectedLibrary({ target }: { target: AbsTarget }) {
  const { data: libraries, isLoading, isError } = useLibraries(target, true)
  const [activeLib, setActiveLib] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-muted-foreground">
        <Loader2 className="animate-spin" size={18} />
        <span className="t-body">Loading libraries...</span>
      </div>
    )
  }
  if (isError || !libraries) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-6">
        <AlertCircle className="mt-0.5 shrink-0 text-destructive" size={18} />
        <p className="t-body text-card-foreground">Couldn't load this server's libraries.</p>
      </div>
    )
  }
  if (libraries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="t-muted text-[13px]">This server has no libraries yet.</p>
      </div>
    )
  }

  const current = activeLib ?? libraries[0].id

  return (
    <WebAppMediaUIProvider target={target}>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {libraries.map((lib) => (
          <button
            key={lib.id}
            onClick={() => {
              setActiveLib(lib.id)
              setQuery('')
            }}
            className={cn(
              'rounded-lg px-3 py-1.5 text-[14px] font-medium transition-colors',
              lib.id === current
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            {lib.name}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this library"
            className={cn(
              'h-9 w-56 rounded-lg border border-input bg-background pl-9 pr-8',
              'text-[14px] text-foreground placeholder:text-muted-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>
      {query.trim() ? (
        <SearchResults target={target} libraryId={current} query={query} />
      ) : (
        <>
          <HomeShelves target={target} libraryId={current} />
          <LibraryGrid target={target} libraryId={current} />
        </>
      )}
    </WebAppMediaUIProvider>
  )
}

function HomeShelves({ target, libraryId }: { target: AbsTarget; libraryId: string }) {
  const { data: shelves } = useShelves(target, libraryId, true)
  if (!shelves) return null
  // Render only the shelves we care about, in our order, that have items.
  const ordered = HOME_SHELVES.map((id) => shelves.find((s) => s.id === id)).filter(
    (s): s is NonNullable<typeof s> => Boolean(s && s.items.length > 0)
  )
  if (ordered.length === 0) return null
  return (
    <div className="mb-2">
      {ordered.map((s) => (
        <ShelfRow key={s.id} label={s.label} items={s.items} />
      ))}
    </div>
  )
}

function SearchResults({
  target,
  libraryId,
  query,
}: {
  target: AbsTarget
  libraryId: string
  query: string
}) {
  const debounced = useDebounced(query, 300)
  const { data, isLoading, isError } = useLibrarySearch(target, libraryId, debounced, true)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="animate-spin" size={18} />
        <span className="t-body">Searching...</span>
      </div>
    )
  }
  if (isError) {
    return <p className="t-muted p-6 text-[13px]">Search failed. Try again.</p>
  }
  if (!data || data.length === 0) {
    return <p className="t-muted p-6 text-[13px]">No results for "{debounced.trim()}".</p>
  }
  return <ItemGrid items={data} />
}

function LibraryGrid({ target, libraryId }: { target: AbsTarget; libraryId: string }) {
  const [page, setPage] = useState(0)
  const { data, isLoading, isError, isPlaceholderData } = useLibraryItems(
    target,
    libraryId,
    page,
    true
  )

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="animate-spin" size={18} />
        <span className="t-body">Loading items...</span>
      </div>
    )
  }
  if (isError || !data) {
    return <p className="t-muted p-6 text-[13px]">Couldn't load items.</p>
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.limit))

  return (
    <div>
      <ItemGrid items={data.items} />

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <span className="t-muted text-[13px]">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page + 1 >= totalPages || isPlaceholderData}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
