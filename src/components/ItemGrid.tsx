import { Link } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
import { itemCoverUrl, type AbsListItem, type AbsTarget } from '@/api/absLibrary'

/**
 * A cover-art grid of library items, each linking into its detail/player page.
 * Shared by browse, search, and the Continue Listening surface.
 */
export function ItemGrid({ target, items }: { target: AbsTarget; items: AbsListItem[] }) {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {items.map((it) => {
        const cover = itemCoverUrl(target, it.id)
        return (
          <li key={it.id}>
            <Link to={`/server/${target.serverId}/item/${it.id}`} className="group block">
              <div className="aspect-square overflow-hidden rounded-lg border border-border bg-secondary transition-colors group-hover:border-primary">
                {cover ? (
                  // eslint-disable-next-line jsx-a11y/img-redundant-alt
                  <img src={cover} alt={it.title} loading="lazy" className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center text-muted-foreground">
                    <BookOpen size={24} />
                  </div>
                )}
              </div>
              <p className="mt-2 line-clamp-2 text-[13px] font-medium text-card-foreground">
                {it.title}
              </p>
              {it.author && <p className="t-muted line-clamp-1 text-[12px]">{it.author}</p>}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
