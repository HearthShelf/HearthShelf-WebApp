import { Icon } from '@/components/common/Icon'

interface ErrorStateProps {
  message?: string
  onRetry?: () => void
}

/**
 * The house error state. Built on the shell's tokens and Material Symbols so a
 * failure still reads as this product; it previously mixed Tailwind role
 * classes, a lucide glyph and the shadcn Button into pages that use none of
 * those.
 */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="hs-error" role="alert">
      <Icon name="cloud_off" />
      <p>{message ?? 'Something went wrong.'}</p>
      {onRetry && (
        <button className="btn-sm btn-ghost" onClick={onRetry}>
          <Icon name="refresh" /> Try again
        </button>
      )}
    </div>
  )
}
