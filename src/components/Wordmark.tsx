import { cn } from '@/lib/cn'

/**
 * The HearthShelf wordmark: Libre Baskerville, "Hearth" in gold + "Shelf"
 * inking dark on light / cream on dark. Mirrors the design system's
 * .t-wordmark role.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('t-wordmark select-none', className)}>
      <span className="lt">Hearth</span>
      <span className="bd">Shelf</span>
    </span>
  )
}
