import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { useLibraryItems } from '@/hooks/useLibrary'
import { getSeriesList, type SeriesSummary } from '@/api/absLibrary'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { ItemGrid } from '@/components/ItemGrid'
import { Icon } from '@/components/common/Icon'

type Tab = 'books' | 'series' | 'authors' | 'narrators'

const TAB_META: { id: Tab; icon: string; label: string }[] = [
  { id: 'books', icon: 'grid_view', label: 'Books' },
  { id: 'series', icon: 'auto_stories', label: 'Series' },
  { id: 'authors', icon: 'person', label: 'Authors' },
  { id: 'narrators', icon: 'mic', label: 'Narrators' },
]

export function LibraryPage() {
  const { target } = useActiveServer()
  const { active, activeId } = useActiveLibrary()
  const [params] = useSearchParams()
  const narratorFilter = params.get('narrator')
  const genreFilter = params.get('genre')

  const tabParam = params.get('tab')
  const [tab, setTab] = useState<Tab>(() =>
    tabParam === 'series' || tabParam === 'authors' || tabParam === 'narrators' ? tabParam : 'books'
  )

  if (!target) return null

  return (
    <div className="page fade-in" style={{ paddingTop: 24 }}>
      <div className="page-head lib-head">
        <div className="lib-head-titles">
          <div className="eyebrow">Your collection</div>
          <h1 className="title-xl">{active?.name ?? 'Library'}</h1>
        </div>
      </div>

      {(narratorFilter || genreFilter) && (
        <p className="page-sub" style={{ marginTop: -8, marginBottom: 'var(--s5)' }}>
          {narratorFilter && (
            <>
              Narrated by <b style={{ color: 'var(--text)' }}>{narratorFilter}</b>
            </>
          )}
          {genreFilter && (
            <>
              Genre <b style={{ color: 'var(--text)' }}>{genreFilter}</b>
            </>
          )}{' '}
          {/* TODO: actual server-side filtering by narrator/genre is not wired yet. */}
          <span style={{ color: 'var(--text-faint)' }}>(filtering coming soon)</span>
        </p>
      )}

      <div className="qv-tabs">
        {TAB_META.map((tb) => (
          <button
            key={tb.id}
            className={'qv-tab' + (tab === tb.id ? ' on' : '')}
            onClick={() => setTab(tb.id)}
          >
            <Icon name={tb.icon} fill={tab === tb.id} />
            <span>{tb.label}</span>
          </button>
        ))}
      </div>

      {tab === 'books' && (
        <BooksTab target={target} libraryId={activeId ?? undefined} />
      )}
      {tab === 'series' && (
        <SeriesTab target={target} libraryId={activeId ?? undefined} />
      )}
      {(tab === 'authors' || tab === 'narrators') && (
        <ComingSoon kind={tab} />
      )}
    </div>
  )
}

function BooksTab({
  target,
  libraryId,
}: {
  target: NonNullable<ReturnType<typeof useActiveServer>['target']>
  libraryId: string | undefined
}) {
  const [page, setPage] = useState(0)
  const { data, isLoading, isError, refetch } = useLibraryItems(
    target,
    libraryId,
    page,
    Boolean(libraryId)
  )

  if (isLoading) {
    return <p className="page-sub">Loading library...</p>
  }
  if (isError || !data) {
    return (
      <div className="empty-state">
        <Icon name="error" />
        <h3>Could not load this library</h3>
        <button className="btn-sm btn-ghost" style={{ margin: '0 auto' }} onClick={() => refetch()}>
          Try again
        </button>
      </div>
    )
  }
  if (data.items.length === 0) {
    return (
      <div className="empty-state">
        <Icon name="library_books" />
        <h3>No books here yet</h3>
        <p>This library is empty.</p>
      </div>
    )
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.limit))

  return (
    <>
      <ItemGrid items={data.items} />
      {totalPages > 1 && (
        <div className="toolbar2" style={{ justifyContent: 'center', marginTop: 'var(--s6)' }}>
          <button className="pill" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            <Icon name="chevron_left" /> Previous
          </button>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Page {page + 1} of {totalPages}
          </span>
          <button
            className="pill"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next <Icon name="chevron_right" />
          </button>
        </div>
      )}
    </>
  )
}

function SeriesTab({
  target,
  libraryId,
}: {
  target: NonNullable<ReturnType<typeof useActiveServer>['target']>
  libraryId: string | undefined
}) {
  const ui = useMediaUI()
  const { data, isLoading, isError } = useQuery<SeriesSummary[]>({
    queryKey: ['abs-series-list', target.serverId, libraryId],
    queryFn: () => getSeriesList(target, libraryId as string),
    enabled: Boolean(libraryId),
    staleTime: 2 * 60 * 1000,
  })

  const series = useMemo(
    () => [...(data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data]
  )

  if (isLoading) {
    return <p className="page-sub">Loading series...</p>
  }
  if (isError) {
    return (
      <div className="empty-state">
        <Icon name="error" />
        <h3>Could not load series</h3>
      </div>
    )
  }
  if (series.length === 0) {
    return (
      <div className="empty-state">
        <Icon name="auto_stories" />
        <h3>No series here</h3>
        <p>This library has no series yet.</p>
      </div>
    )
  }

  return (
    <div className="series-grid">
      {series.map((s) => {
        const href = ui.seriesHref?.(s.id) ?? `/series/${s.id}`
        return (
          <Link key={s.id} to={href} className="series-card" style={{ textDecoration: 'none' }}>
            <div className="series-meta">
              <h3>{s.name}</h3>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

function ComingSoon({ kind }: { kind: 'authors' | 'narrators' }) {
  return (
    <div className="empty-state">
      <Icon name={kind === 'authors' ? 'person' : 'mic'} />
      <h3>{kind === 'authors' ? 'Authors' : 'Narrators'} coming soon</h3>
      <p>
        Browsing by {kind === 'authors' ? 'author' : 'narrator'} isn&apos;t available here yet.
      </p>
    </div>
  )
}
