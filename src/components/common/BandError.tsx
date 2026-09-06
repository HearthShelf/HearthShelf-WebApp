import { Icon } from '@/components/common/Icon'

/**
 * A quiet inline failure for one Home band.
 *
 * Secondary bands used to render `null` on error, which made "this failed to
 * load" and "you have none of these" the same screen - the reader never learned
 * anything went wrong and the host never got told. This keeps the band in place
 * at its own scale: a line of muted text and a retry, never a page-level alarm.
 */
export function BandError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="section band-error" role="status">
      <Icon name="cloud_off" />
      <span className="be-t">{label} could not be loaded.</span>
      <button className="btn-sm btn-ghost" onClick={onRetry}>
        <Icon name="refresh" /> Try again
      </button>
    </div>
  )
}
