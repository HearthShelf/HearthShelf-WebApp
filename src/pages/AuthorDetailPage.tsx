import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useMediaProgress } from '@/hooks/useMediaProgress'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { getAuthorFull } from '@/api/absBrowse'
import { absMediaUrl } from '@/api/absClient'
import { tintFor } from '@/components/shared/Cover'
import { initialsOf } from '@/components/library/AuthorCard'
import { BookTile } from '@/components/library/BookTile'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'

// Whole hours, rounded, as "12h". Author/series totals are coarse by design.
function hoursLabel(totalSec: number): string {
  return `${Math.round(totalSec / 3600)}h`
}

/**
 * Author detail: avatar (photo or gradient initials), bio, listening stats, and
 * a grid of their books with per-book progress. Renders inside
 * <ActiveServerMediaUI>, so the active server is connected and the MediaUI
 * provider is mounted; we read the target from useActiveServer().
 */
export function AuthorDetailPage() {
  const { authorId } = useParams()
  const navigate = useNavigate()
  const { target } = useActiveServer()
  const ui = useMediaUI()
  const progressById = useMediaProgress()
  const isMobile = useIsMobile()
  const [imgOk, setImgOk] = useState(true)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['abs-author-full', target?.serverId, authorId],
    queryFn: () => getAuthorFull(target!, authorId as string),
    enabled: Boolean(target) && Boolean(authorId),
    staleTime: 5 * 60 * 1000,
  })

  if (!target || isLoading) {
    return (
      <div className="page">
        <LoadingSpinner className="py-12" label="Loading author..." />
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="page">
        <ErrorState message="Could not load this author." onRetry={refetch} />
      </div>
    )
  }

  const books = data.books
  const totalSec = books.reduce((s, b) => s + (b.media.duration ?? 0), 0)
  const finished = books.filter((b) => progressById.get(b.id)?.isFinished).length
  const cv = tintFor(data.name)
  const imgSrc = absMediaUrl(target, `/api/authors/${encodeURIComponent(data.id)}/image`)
  const hasImg = imgOk && Boolean(data.imagePath) && Boolean(imgSrc)

  const avatar = (
    <div
      className="author-av"
      style={{
        background: `linear-gradient(150deg, ${cv}, color-mix(in oklab, ${cv} 45%, #000))`,
      }}
    >
      {hasImg ? (
        <img
          className="author-photo"
          src={imgSrc as string}
          alt={data.name}
          onError={() => setImgOk(false)}
        />
      ) : (
        initialsOf(data.name)
      )}
    </div>
  )

  // Start listening = first unfinished book in their list, else the first book.
  const startListening = () => {
    const next = books.find((b) => !progressById.get(b.id)?.isFinished) ?? books[0]
    if (next) ui.playItem(next.id)
  }

  const bookGrid = (
    <div className={'lib-grid' + (isMobile ? ' compact' : '')}>
      {books.map((b) => {
        const p = progressById.get(b.id)
        return (
          <BookTile
            key={b.id}
            item={b}
            progress={p?.progress ?? 0}
            finished={p?.isFinished}
            compact={isMobile}
          />
        )
      })}
    </div>
  )

  const statLine = `${books.length} ${books.length === 1 ? 'book' : 'books'} · ${hoursLabel(
    totalSec
  )} · ${finished} finished`

  if (isMobile) {
    return (
      <div className="page fade-in" style={{ ['--glow-accent' as string]: cv }}>
        <button
          className="pill"
          style={{ marginBottom: 14 }}
          onClick={() => navigate('/library?tab=authors')}
        >
          <Icon name="arrow_back" /> Authors
        </button>
        <div className="author-hero mob">
          <div className="ah-row">
            {avatar}
            <div className="ah-id">
              <div className="eyebrow">Author</div>
              <h1 className="author-mtitle">{data.name}</h1>
              <div className="ah-meta">{statLine}</div>
            </div>
          </div>
          {data.description && <p className="author-mbio">{data.description}</p>}
          <div className="ah-actions">
            {books[0] && (
              <button className="btn btn-primary ah-cta" onClick={startListening}>
                <Icon name="play_arrow" fill /> Listen
              </button>
            )}
          </div>
        </div>
        <div className="section">
          <div className="section-head">
            <Icon name="auto_stories" />
            <h2>Books · {books.length}</h2>
          </div>
          {books.length > 0 ? (
            bookGrid
          ) : (
            <p className="page-sub">No books found for this author.</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="page fade-in" style={{ ['--glow-accent' as string]: cv }}>
      <button
        className="pill"
        style={{ marginBottom: 24 }}
        onClick={() => navigate('/library?tab=authors')}
      >
        <Icon name="arrow_back" /> Authors
      </button>

      <div className="author-hero">
        {avatar}
        <div>
          <div className="eyebrow">Author</div>
          <h1>{data.name}</h1>
          <div className="page-sub" style={{ marginTop: 6 }}>
            {statLine}
          </div>
          {data.description && <p className="bio">{data.description}</p>}
          <div style={{ marginTop: 12 }}>
            {books[0] && (
              <button className="btn btn-primary" onClick={startListening}>
                <Icon name="play_arrow" fill /> Start listening
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <Icon name="auto_stories" />
          <h2>Books</h2>
        </div>
        {books.length > 0 ? (
          bookGrid
        ) : (
          <p className="page-sub">No books found for this author.</p>
        )}
      </div>
    </div>
  )
}
