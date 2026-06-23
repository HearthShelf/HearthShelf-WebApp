import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'

/**
 * The HearthShelf wordmark: Libre Baskerville, "Hearth" in gold + "Shelf"
 * inking dark on light / cream on dark. Mirrors the design system's
 * .t-wordmark role.
 */
export function Wordmark({
  className,
  style,
}: {
  className?: string
  style?: CSSProperties
}) {
  return (
    <span className={cn('t-wordmark select-none', className)} style={style}>
      <span className="lt">Hearth</span>
      <span className="bd">Shelf</span>
    </span>
  )
}
