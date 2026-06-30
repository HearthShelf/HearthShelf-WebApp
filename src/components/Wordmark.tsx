import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'

/**
 * The HearthShelf wordmark: Libre Baskerville, "Hearth" in gold + "Shelf"
 * inking dark on light / cream on dark. Uses the design.css `.wordmark` rules
 * (what the sidebar `.brand` lockup is sized/coloured around), matching the
 * self-hosted shell.
 */
export function Wordmark({
  className,
  style,
}: {
  className?: string
  style?: CSSProperties
}) {
  return (
    <span className={cn('wordmark select-none', className)} style={style}>
      <span className="lt">Hearth</span>
      <span className="bd">Shelf</span>
    </span>
  )
}
