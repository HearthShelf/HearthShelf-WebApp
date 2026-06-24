import { Link } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
import { itemCoverUrl, type AbsListItem, type AbsTarget } from '@/api/absLibrary'

/**
 * A horizontal, scrollable row of cover cards for a home shelf (Continue
 * Listening, Recently Added). Narrower fixed-width cards so several fit across;
 * each links into the detail/player page.
 */
export function ShelfRow({
  target,
  label,
  items,
}: {
  target: AbsTarget
  label: string
  items: AbsListItem[]
}) {
  if (items.length === 0) return null
  return (
    <section className="mb-8">
      <h2 className="t-h2 mb-3">{label}</h2>
      <ul className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
        {items.map((it) => {
          const cover = itemCoverUrl(target, it.id)
          return (
            <li key={it.id} className="w-32 shrink-0">
              <Link to={`/server/${target.serverId}/item/${it.id}`} className="group block">
                <div className="aspect-square overflow-hidden rounded-lg border border-border bg-secondary transition-colors group-hover:border-primary">
                  {cover ? (
                    // eslint-disable-next-line jsx-a11y/img-redundant-alt
                    <img src={cover} alt={it.title} loading="lazy" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-muted-foreground">
                      <BookOpen size={22} />
                    </div>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-[12px] font-medium text-card-foreground">
                  {it.title}
                </p>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
