import { Icon } from '@/components/common/Icon'
import { cn } from '@/lib/cn'

interface LoadingSpinnerProps {
  className?: string
  label?: string
}

/**
 * The house loading state. Uses the shell's own tokens and Material Symbols
 * rather than Tailwind role classes + a lucide glyph, so a page that is busy
 * still looks like the same product - the stroke weight and corner language of
 * a second icon set were most visible at exactly the wrong moment.
 */
export function LoadingSpinner({ className, label }: LoadingSpinnerProps) {
  return (
    <div className={cn('hs-loading', className)} role="status">
      <Icon name="progress_activity" className="hs-loading-spin" />
      {label && <span>{label}</span>}
    </div>
  )
}
