import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useActiveLibrary } from '@/hooks/useActiveLibrary'
import { getMe, type AbsLibraryItem, type AbsSeries } from '@/api/absLibrary'
import { getSeriesFull } from '@/api/absBrowse'
import { fetchAudibleSeries, audibleKeys } from '@/api/absAudible'
import { missingSeriesBooks, seriesSeqFromName, seriesCompletion } from '@hearthshelf/core'
import type { OwnedSeriesBook } from '@hearthshelf/core'
import { SeriesMissingBooks } from '@/components/requests/SeriesMissingBooks'
import { useMediaProgress } from '@/hooks/useMediaProgress'
import { usePromptedMarkFinished } from '@/hooks/useMarkFinished'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useToast } from '@/hooks/useToast'
import { orderBooks } from '@/lib/seriesOrder'
import { Cover, tintFor } from '@/components/shared/Cover'
import { Icon } from '@/components/common/Icon'
import { BookContextMenu } from '@/components/library/BookContextMenu'
import { BatchEditModal } from '@/components/library/BatchEditModal'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'
import type { AbsTarget } from '@/api/absLibrary'

// Count-aware cover cluster: 1 solo, 2 stacked, 3 two+one, 4+ a 2x2 square with
// an optional centered 5th carrying a "+N" overflow chip.
function HeroCovers({ books }: { books: AbsLibraryItem[] }) {
  const n = books.length
  const layout = n >= 4 ? 'square' : n === 3 ? 'tri' : n === 2 ? 'duo' : 'solo'
  const cover = (b: AbsLibraryItem, fs: number) => (
    <Cover key={b.id} itemId={b.id} title={b.media.metadata.title ?? 'Untitled'} fs={fs} />
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

function SeriesDetail({ series, target }: { series: AbsSeries; target: AbsTarget }) {
  const navigate = useNavigate()
  const ui = useMediaUI()
  const progressById = useMediaProgress()
  const { markFinishedPrompted, isPending: marking } = usePromptedMarkFinished()
  const isMobile = useIsMobile()
  const { toast, show } = useToast()
  const books = orderBooks(series.books ?? [])
  const author = books[0]?.media.metadata.authorName || ''
  const cv = tintFor(books[0]?.media.metadata.title ?? series.name)
  // Owned books reduced to what series-matching needs: title + this-series
  // sequence (from the denormalized seriesName). Matched to the Audible roster by
  // sequence first, then normalized title, so owned books never read as missing.
  const ownedBooks: OwnedSeriesBook[] = books.map((b) => ({
    title: b.media.metadata.title,
    sequence: seriesSeqFromName(b.media.metadata.seriesName),
  }))

  // Full Audible roster for the series (cached; SeriesMissingBooks reuses it).
  // The unowned gap enlarges the completion denominator so the % and the segment
  // track measure against the whole series, not just what's owned.
  const { data: audible } = useQuery({
    queryKey: audibleKeys.series(series.name),
    queryFn: () => fetchAudibleSeries(target, series.name),
    enabled: series.name.length >= 2,
    staleTime: 30 * 60 * 1000,
    retry: false,
  })
  const missing = audible?.seriesAsin ? missingSeriesBooks(audible.books, ownedBooks) : []

  // Admin gating for the bulk-edit action.
  const { data: me } = useQuery({
    queryKey: ['abs-me', target.serverId],
    queryFn: () => getMe(target),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
  const canEdit = me?.type === 'admin' || me?.type === 'root' || Boolean(me?.permissions?.update)

  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [batchEditing, setBatchEditing] = useState(false)
  const toggleSel = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const clearSel = () => {
    setSelected(new Set())
    setSelectMode(false)
  }
  const selectAll = () => setSelected(new Set(books.map((b) => b.id)))

  const allSeriesFinished =
    books.length > 0 && books.every((b) => progressById.get(b.id)?.isFinished)
  // Quick-mark the whole series: finish all, or unfinish if already all done.
  const markSeries = () => {
    if (!books.length) return
    void markFinishedPrompted(
      books.map((b) => b.id),
      !allSeriesFinished,
    )
  }
  // Mark the current selection, toggling off if every selected book is finished.
  const markSelection = () => {
    const ids = [...selected]
    if (!ids.length) return
    const allFinished = ids.every((id) => progressById.get(id)?.isFinished)
    void markFinishedPrompted(ids, !allFinished).then((ok) => {
      if (ok) clearSel()
    })
  }

  // Per-book progress, finished count, totals.
  let done = 0
  let sum = 0
  let totalHours = 0
  for (const b of books) {
    const p = progressById.get(b.id)
    if (p?.isFinished) done++
    sum += p?.isFinished ? 1 : (p?.progress ?? 0)
    totalHours += (b.media.duration ?? 0) / 3600
  }
  const completion = seriesCompletion({
    ownedProgressSum: sum,
    ownedCount: books.length,
    missingCount: missing.length,
  })
  const pct = completion.pct
  // Listened hours are an owned-books figure; scale by owned progress, not the
  // full-series percentage.
  const listenedHours = books.length ? totalHours * (sum / books.length) : 0

  // Next up = first unfinished in reading order, else the first book.
  const nextUpIdx = books.findIndex((b) => !progressById.get(b.id)?.isFinished)
  const nextUp = nextUpIdx === -1 ? books[0] : books[nextUpIdx]
  const nextUpNum = (nextUpIdx === -1 ? 0 : nextUpIdx) + 1

  // Shared progress widgets (segment track + bottom hours bar).
  const progEl = (
    <div className="series-prog">
      <div className="sp-top">
        <span className="sp-pct">{Math.round(pct * 100)}%</span>
        <span className="sp-cap">
          {done} of {completion.totalCount} finished · {listenedHours.toFixed(0)}h of{' '}
          {totalHours.toFixed(0)}h
          {completion.missingCount > 0 && ` · ${completion.missingCount} not in library`}
        </span>
      </div>
      <div className="sp-track">
        {books.map((b, i) => {
          const p = progressById.get(b.id)
          const fin = p?.isFinished
          const part = !fin && (p?.progress ?? 0) > 0
          const status = fin
            ? 'finished'
            : part
              ? `${Math.round((p?.progress ?? 0) * 100)}%`
              : 'not started'
          return (
            <div
              key={b.id}
              className={'sp-seg' + (fin ? ' done' : '') + (part ? ' part' : '')}
              title={`Book ${i + 1} · ${status}`}
            >
              {part && <i style={{ width: (p?.progress ?? 0) * 100 + '%' }} />}
            </div>
          )
        })}
        {missing.map((b, i) => (
          <div
            key={b.asin}
            className="sp-seg missing"
            title={`Book ${books.length + i + 1} · not in library`}
          />
        ))}
      </div>
    </div>
  )
  const heroProg = (
    <div className="hero-prog">
      <div className="hp-fill" style={{ width: pct * 100 + '%' }}>
        <span className="hp-head" />
      </div>
    </div>
  )

  const hero = isMobile ? (
    <div className="series-hero mob">
      <div className="eyebrow">Series</div>
      <h1 className="series-mtitle">{series.name}</h1>
      {author && <div className="series-msub">{author}</div>}
      <div className="series-mstats">
        <span>
          <b>{books.length}</b>books
        </span>
        <span>
          <b>{totalHours.toFixed(0)}h</b>total
        </span>
        <span>
          <b>
            {done}/{completion.totalCount}
          </b>
          finished
        </span>
      </div>
      {progEl}
      {nextUp && (
        <button className="btn btn-primary mob-cta" onClick={() => ui.playItem(nextUp.id)}>
          <Icon name="play_arrow" fill /> Continue · Book {nextUpNum}
        </button>
      )}
      <div className="mob-actions">
        <button className="pill" disabled={marking} onClick={markSeries}>
          <Icon name={allSeriesFinished ? 'remove_done' : 'done_all'} />{' '}
          {allSeriesFinished ? 'Not finished' : 'Mark finished'}
        </button>
      </div>
      {heroProg}
    </div>
  ) : (
    <div className="series-hero">
      <HeroCovers books={books} />
      <div className="series-hero-meta">
        <div className="eyebrow">Series</div>
        <h1 className="title-xl">{series.name}</h1>
        <div style={{ color: 'var(--text-muted)', fontSize: 14.5, margin: '8px 0 18px' }}>
          {author && `${author} · `}
          {books.length} {books.length === 1 ? 'book' : 'books'} · {totalHours.toFixed(0)}h total
          {completion.missingCount > 0 && ` · ${completion.missingCount} not in library`}
        </div>

        {progEl}

        <div style={{ display: 'flex', gap: 12, marginTop: 22, flexWrap: 'wrap' }}>
          {nextUp && (
            <button className="btn btn-primary" onClick={() => ui.playItem(nextUp.id)}>
              <Icon name="play_arrow" fill /> Continue · Book {nextUpNum}
            </button>
          )}
          <button className="pill" disabled={marking} onClick={markSeries}>
            <Icon name={allSeriesFinished ? 'remove_done' : 'done_all'} />{' '}
            {allSeriesFinished ? 'Mark series unfinished' : 'Mark series finished'}
          </button>
        </div>
      </div>

      {heroProg}
    </div>
  )

  return (
    <div className="page fade-in" style={{ ['--glow-accent' as string]: cv }}>
      <button
        className="pill"
        style={{ marginBottom: isMobile ? 16 : 24 }}
        onClick={() => navigate('/library?tab=series')}
      >
        <Icon name="arrow_back" /> Library
      </button>

      {hero}

      <div className="section">
        {selected.size > 0 ? (
          <div className="toolbar2 sel-bar">
            <button className="pill" onClick={clearSel} title="Clear selection">
              <Icon name="close" />
            </button>
            <span className="count-badge" style={{ color: 'var(--accent)', fontWeight: 600 }}>
              {selected.size} selected
            </span>
            {selected.size < books.length && (
              <button className="pill" onClick={selectAll}>
                Select all {books.length}
              </button>
            )}
            <div className="tb-spacer" />
            {canEdit && (
              <button className="pill" onClick={() => setBatchEditing(true)}>
                <Icon name="edit" /> Edit
              </button>
            )}
            <button className="pill" disabled={marking} onClick={markSelection}>
              <Icon name="task_alt" />{' '}
              {[...selected].every((id) => progressById.get(id)?.isFinished)
                ? 'Mark not finished'
                : 'Mark finished'}
            </button>
          </div>
        ) : (
          <div className="series-list-head">
            <div className="section-head">
              <Icon name="format_list_numbered" />
              <h2>In reading order</h2>
            </div>
            <button
              className={'pill' + (selectMode ? ' on' : '')}
              onClick={() => setSelectMode((v) => !v)}
            >
              <Icon name="checklist" /> {selectMode ? 'Done' : 'Select'}
            </button>
          </div>
        )}
        <div className="series-list">
          {books.map((b, i) => {
            const m = b.media.metadata
            const p = progressById.get(b.id)
            const fin = p?.isFinished
            const part = !fin && (p?.progress ?? 0) > 0
            const hours = b.media.duration ? Math.round(b.media.duration / 360) / 10 : 0
            const isSel = selected.has(b.id)
            const active = selectMode || selected.size > 0
            return (
              <BookContextMenu
                key={b.id}
                item={b}
                target={target}
                progress={p?.progress}
                finished={fin}
                seriesId={series.id}
                seriesName={series.name}
                onToast={show}
              >
                <div
                  className={'sl-row' + (isSel ? ' sel' : '')}
                  data-cv={tintFor(m.title ?? 'Untitled')}
                  onClick={() => (active ? toggleSel(b.id) : ui.openItem(b.id))}
                >
                  {active ? (
                    <button
                      className={'b-check sl-check' + (isSel ? ' on' : '')}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleSel(b.id)
                      }}
                      aria-label={isSel ? 'Deselect' : 'Select'}
                    >
                      <Icon name="check" fill style={{ opacity: isSel ? 1 : 0 }} />
                    </button>
                  ) : (
                    <div className="sl-num">{i + 1}</div>
                  )}
                  <Cover itemId={b.id} title={m.title ?? 'Untitled'} fs={6} className="sl-cover" />
                  <div className="sl-meta">
                    <div className="sl-title">
                      {m.title}
                      {fin && (
                        <Icon
                          name="check_circle"
                          fill
                          style={{
                            fontSize: 16,
                            color: 'var(--text-muted)',
                            marginLeft: 8,
                            verticalAlign: '-3px',
                          }}
                        />
                      )}
                    </div>
                    <div className="sl-sub">
                      {[m.narratorName, hours > 0 && `${hours}h`].filter(Boolean).join(' · ')}
                    </div>
                    {part && (
                      <div className="prog-line" style={{ marginTop: 8, maxWidth: 280 }}>
                        <i style={{ width: (p?.progress ?? 0) * 100 + '%' }} />
                      </div>
                    )}
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
              </BookContextMenu>
            )
          })}
          {selected.size === 0 && (
            <SeriesMissingBooks
              target={target}
              seriesName={series.name}
              ownedBooks={ownedBooks}
              startSeq={books.length}
            />
          )}
        </div>
      </div>

      {batchEditing && (
        <BatchEditModal
          ids={[...selected]}
          items={books.filter((b) => selected.has(b.id))}
          target={target}
          onClose={() => setBatchEditing(false)}
          onDone={() => {
            setBatchEditing(false)
            clearSel()
          }}
        />
      )}
      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
    </div>
  )
}

export function SeriesDetailPage() {
  const { seriesId } = useParams()
  const { target } = useActiveServer()
  const { activeId } = useActiveLibrary()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['abs-series-full', target?.serverId, activeId, seriesId],
    queryFn: () => getSeriesFull(target!, activeId!, seriesId!),
    enabled: Boolean(target) && Boolean(activeId) && Boolean(seriesId),
    staleTime: 2 * 60 * 1000,
  })

  if (!target) return null

  if (isLoading) {
    return (
      <div className="page">
        <LoadingSpinner className="py-12" label="Loading series..." />
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="page">
        <ErrorState message="Could not load this series." onRetry={refetch} />
      </div>
    )
  }

  return <SeriesDetail series={data} target={target} />
}
