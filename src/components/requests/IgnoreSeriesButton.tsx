import { Icon } from '@/components/common/Icon'
import { useIgnoreSeries } from '@/hooks/useIgnoredBooks'

interface IgnoreSeriesButtonProps {
  // ABS series id - what a series ignore keys on. Unlike a follow (which needs
  // an Audible ASIN), ignoring works on any series in the library, including one
  // that never resolved against Audible.
  seriesId: string | undefined
  // Icon-only rendering for tight rows, where the label would not fit. The
  // tooltip and aria-label still carry the meaning.
  compact?: boolean
}

// Ignore a series: "no interest". It stops being suggested - the Auto queue,
// Continue Series, Discover, and QuestGiver all skip it - but it stays in the
// library and in search. The paired control to Follow, and rendered beside it.
export function IgnoreSeriesButton({ seriesId, compact }: IgnoreSeriesButtonProps) {
  const { ignored, toggle, busy } = useIgnoreSeries(seriesId)

  if (!seriesId) return null

  const label = ignored ? 'Ignored' : 'Ignore series'
  const title = ignored
    ? 'Not suggested to you. Still in your library - click to un-ignore'
    : 'Stop suggesting this series. It stays in your library'

  return (
    <button
      className={'pill' + (ignored ? ' on' : '')}
      onClick={() => !busy && toggle.mutate()}
      disabled={busy}
      title={title}
      aria-pressed={ignored}
      aria-label={label}
    >
      <Icon name={ignored ? 'visibility_off' : 'visibility'} fill={ignored} />
      {!compact && ' ' + label}
    </button>
  )
}
