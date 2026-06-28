import { useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import {
  getSeriesItems,
  getSeriesList,
  type AbsListItem,
} from '@/api/absLibrary'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { Cover, tintFor } from '@/components/shared/Cover'
import { Icon } from '@/components/common/Icon'

// Count-aware cover cluster: 1 solo, 2 stacked, 3 two+one, 4+ a 2x2 square
// with an optional centered 5th carrying a "+N" overflow chip.
function HeroCovers({ books }: { books: AbsListItem[] }) {
  const n = books.length
  const layout = n >= 4 ? 'square' : n === 3 ? 'tri' : n === 2 ? 'duo' : 'solo'
  const cover = (b: AbsListItem, fs: number) => (
    <Cover key={b.id} itemId={b.id} title={b.title || 'Untitled'} fs={fs} />
  )

  return (
    <div className={'hero-covers ' + layout}>
      {layout === 'solo' && cover(books[0], 13)}
      {layout === 'duo' && books.slice(0, 2).map((b) => cover(b, 11))}
      {layout === 'tri' && (
        <>
          <div className="hc-row">{books.slice(0, 2).map((b) => cover(b, 10))}</div>
          <div className="hc-btm">{cover(books[2], 10)}</div>
        </>
      )}
      {layout === 'square' && (
        <>
          <div className="hc-grid">{books.slice(0, 4).map((b) => cover(b, 8))}</div>
          {n >= 5 && (
            <div className="hc-center">
              <div className="hc-fifth">
                {cover(books[4], 8)}
                {n > 5 && <span className="hc-more">+{n - 5}</span>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SeriesDetail({ name, books }: { name: string; books: AbsListItem[] }) {
  const navigate = useNavigate()
  const ui = useMediaUI()
  const author = books[0]?.author || ''
  const cv = tintFor(books[0]?.title ?? name)
  const totalHours = books.reduce((s, b) => s + (b.durationSec ?? 0) / 3600, 0)
  const nextUp = books[0]

  return (
    <div className="page fade-in" style={{ ['--glow-accent' as string]: cv }}>
      <button
        className="pill"
        style={{ marginBottom: 24 }}
        onClick={() => navigate('/library?tab=series')}
      >
        <Icon name="arrow_back" /> Library
      </button>

      <div className="series-hero">
        <HeroCovers books={books} />
        <div className="series-hero-meta">
          <div className="eyebrow">Series</div>
          <h1 className="title-xl">{name}</h1>
          <div style={{ color: 'var(--text-muted)', fontSize: 14.5, margin: '8px 0 18px' }}>
            {author && `${author} · `}
            {books.length} {books.length === 1 ? 'book' : 'books'} ·{' '}
            {totalHours.toFixed(0)}h total
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 22, flexWrap: 'wrap' }}>
            {nextUp && (
              <button className="btn btn-primary" onClick={() => ui.playItem(nextUp.id)}>
                <Icon name="play_arrow" fill /> Continue · Book 1
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="section">
        <div className="series-list-head">
          <div className="section-head">
            <Icon name="format_list_numbered" />
            <h2>In reading order</h2>
          </div>
        </div>
        <div className="series-list">
          {books.map((b, i) => {
            const hours = b.durationSec ? Math.round(b.durationSec / 360) / 10 : 0
            return (
              <div
                key={b.id}
                className="sl-row"
                data-cv={tintFor(b.title || 'Untitled')}
                onClick={() => ui.openItem(b.id)}
              >
                <div className="sl-num">{i + 1}</div>
                <Cover itemId={b.id} title={b.title || 'Untitled'} fs={6} className="sl-cover" />
                <div className="sl-meta">
                  <div className="sl-title">{b.title}</div>
                  <div className="sl-sub">
                    {[b.author, hours > 0 && `${hours}h`].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="sl-rating" />
                <button
                  className="icon-btn sl-play"
                  onClick={(e) => {
                    e.stopPropagation()
                    ui.playItem(b.id)
                  }}
                  aria-label="Play"
                >
                  <Icon name="play_arrow" fill />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function SeriesDetailPage() {
  const { seriesId } = useParams()
  const { target } = useActiveServer()
  const { activeId } = useActiveLibrary()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['abs-series-items', target?.serverId, activeId, seriesId],
    queryFn: () => getSeriesItems(target!, activeId!, seriesId!),
    enabled: Boolean(target) && Boolean(activeId) && Boolean(seriesId),
    staleTime: 2 * 60 * 1000,
  })

  // getSeriesItems returns an empty name; resolve the display name from the list.
  const { data: seriesList } = useQuery({
    queryKey: ['abs-series-list', target?.serverId, activeId],
    queryFn: () => getSeriesList(target!, activeId!),
    enabled: Boolean(target) && Boolean(activeId),
    staleTime: 5 * 60 * 1000,
  })
  const name = useMemo(
    () => seriesList?.find((s) => s.id === seriesId)?.name ?? 'Series',
    [seriesList, seriesId]
  )

  if (!target) return null

  if (isLoading) {
    return (
      <div className="page">
        <p className="page-sub">Loading series...</p>
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="page">
        <div className="empty-state">
          <Icon name="error" />
          <h3>Could not load this series.</h3>
          <button className="btn-sm btn-ghost" style={{ margin: '0 auto' }} onClick={() => refetch()}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  return <SeriesDetail name={name} books={data.items} />
}
