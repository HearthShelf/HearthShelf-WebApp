import { Link } from 'react-router-dom'
import { BookOpen, Star } from 'lucide-react'
import { useMediaUI } from '@/components/shared/MediaUIContext'

/**
 * Pure, shareable book/audiobook detail HEADER: cover + title/subtitle, series +
 * author + narrator/genre links, rating, duration, and description. The play
 * affordance and any tabs/admin actions stay in the host page - this is just the
 * presentational header both apps render identically.
 *
 * All data is plain props (no ABS type import). Cover and the optional nav links
 * come from MediaUIProvider, so series/author/narrator/genre route per app (or
 * render as plain text when the app supplies no href).
 */
export interface BookHeaderData {
  id: string
  title: string
  subtitle?: string
  author?: string
  authorId?: string
  narrator?: string
  series?: { id: string; name: string; sequence?: string }
  genre?: string
  publishedYear?: string
  /** 0..5, or null if unrated. */
  rating?: number | null
  durationSec: number
  chapterCount: number
  /** Plain-text description (host strips HTML before passing). */
  description?: string
}

function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0m'
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Render an optional nav link: a <Link> when href is given, else plain text. */
function MaybeLink({ href, children }: { href: string | null | undefined; children: React.ReactNode }) {
  if (!href) return <span className="text-foreground">{children}</span>
  return (
    <Link to={href} className="text-foreground underline-offset-2 hover:underline">
      {children}
    </Link>
  )
}

export function BookHeader({ data }: { data: BookHeaderData }) {
  const ui = useMediaUI()
  const cover = ui.coverUrl(data.id, 480)
  const seriesHref = data.series && ui.seriesHref ? ui.seriesHref(data.series.id) : null
  const authorHref = data.authorId && ui.authorHref ? ui.authorHref(data.authorId) : null
  const narratorHref = data.narrator && ui.narratorHref ? ui.narratorHref(data.narrator) : null
  const genreHref = data.genre && ui.genreHref ? ui.genreHref(data.genre) : null

  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      <div className="mx-auto w-48 shrink-0 sm:mx-0">
        <div className="aspect-square overflow-hidden rounded-xl border border-border bg-secondary">
          {cover ? (
            <img src={cover} alt={data.title} className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <BookOpen size={32} />
            </div>
          )}
        </div>
      </div>

      <div className="flex-1">
        <h1 className="t-h1">{data.title}</h1>
        {data.subtitle && <p className="t-body mt-1 text-muted-foreground">{data.subtitle}</p>}

        {data.series && (
          <div className="mt-2">
            <MaybeLink href={seriesHref}>
              <span className="inline-block rounded-md bg-secondary px-2 py-0.5 text-[13px] text-secondary-foreground">
                {data.series.name}
                {data.series.sequence ? ` #${data.series.sequence}` : ''}
              </span>
            </MaybeLink>
          </div>
        )}

        {data.author && (
          <p className="t-body mt-2 text-muted-foreground">
            By <MaybeLink href={authorHref}>{data.author}</MaybeLink>
          </p>
        )}

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          {data.narrator && (
            <>
              <dt className="text-muted-foreground">Narrator</dt>
              <dd>
                <MaybeLink href={narratorHref}>{data.narrator}</MaybeLink>
              </dd>
            </>
          )}
          {data.publishedYear && (
            <>
              <dt className="text-muted-foreground">Published</dt>
              <dd className="text-card-foreground">{data.publishedYear}</dd>
            </>
          )}
          {data.genre && (
            <>
              <dt className="text-muted-foreground">Genre</dt>
              <dd>
                <MaybeLink href={genreHref}>{data.genre}</MaybeLink>
              </dd>
            </>
          )}
          {data.rating != null && data.rating > 0 && (
            <>
              <dt className="text-muted-foreground">Rating</dt>
              <dd className="flex items-center gap-1.5 text-card-foreground">
                <Star size={14} className="fill-primary text-primary" />
                <span className="t-mono">{data.rating.toFixed(1)}</span>
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Duration</dt>
          <dd className="t-mono text-card-foreground">
            {fmtDuration(data.durationSec)} · {data.chapterCount} chapters
          </dd>
        </dl>

        {data.description && (
          <div className="mt-5">
            <p className="t-body whitespace-pre-line text-muted-foreground">{data.description}</p>
          </div>
        )}
      </div>
    </div>
  )
}
