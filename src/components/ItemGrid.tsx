import { useMemo } from 'react'
import { BookTile } from '@/components/shared/BookTile'
import { ReadersProvider } from '@/components/shared/ReadersContext'
import type { AbsListItem } from '@/api/absLibrary'

/**
 * A cover-art grid of library items. Renders the SHARED BookTile (which reads
 * cover/navigation from MediaUIProvider), so this grid carries no app-specific
 * wiring. Used by browse, search, and the home shelves.
 *
 * Wraps its tiles in a ReadersProvider so each card can show a reader-avatar
 * stack ("who else finished this") from one batched query for the grid.
 */
export function ItemGrid({ items }: { items: AbsListItem[] }) {
  const ids = useMemo(() => items.map((it) => it.id), [items])
  return (
    <ReadersProvider itemIds={ids}>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {items.map((it) => (
          <li key={it.id}>
            <BookTile item={{ id: it.id, title: it.title, author: it.author }} />
          </li>
        ))}
      </ul>
    </ReadersProvider>
  )
}
