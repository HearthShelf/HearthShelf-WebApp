import { BookTile } from '@/components/shared/BookTile'
import type { AbsListItem } from '@/api/absLibrary'

/**
 * A horizontal, scrollable row of cover cards for a home shelf (Continue
 * Listening, Recently Added). Uses the shared BookTile (cover/navigation come
 * from MediaUIProvider), in fixed-width cells so several fit across.
 */
export function ShelfRow({ label, items }: { label: string; items: AbsListItem[] }) {
  if (items.length === 0) return null
  return (
    <section className="mb-8">
      <h2 className="t-h2 mb-3">{label}</h2>
      <ul className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
        {items.map((it) => (
          <li key={it.id} className="w-32 shrink-0">
            <BookTile item={{ id: it.id, title: it.title, author: it.author }} />
          </li>
        ))}
      </ul>
    </section>
  )
}
