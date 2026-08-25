import { Icon } from '@/components/common/Icon'

export function CommentVisibilityControl({
  visibleAhead,
  onChange,
  compact = false,
}: {
  visibleAhead: boolean
  onChange: (visible: boolean) => void
  compact?: boolean
}) {
  return (
    <div className={'comment-visibility-control' + (compact ? ' compact' : '')}>
      <span className="comment-control-label">Until they reach this point</span>
      <span
        className="seg comment-visibility-options"
        role="radiogroup"
        aria-label="Comment visibility before readers reach this point"
      >
        <button
          type="button"
          role="radio"
          aria-checked={!visibleAhead}
          className={visibleAhead ? '' : 'on'}
          onClick={() => onChange(false)}
          title="Hidden until they reach this point in the book"
        >
          <Icon name="lock" /> Hidden
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={visibleAhead}
          className={visibleAhead ? 'on' : ''}
          onClick={() => onChange(true)}
          title="Visible to everyone now"
        >
          <Icon name="visibility" /> Visible
        </button>
      </span>
    </div>
  )
}

export function SpoilerToggle({
  on,
  onChange,
  compact = false,
}: {
  on: boolean
  onChange: (on: boolean) => void
  compact?: boolean
}) {
  return (
    <button
      type="button"
      className={'comment-spoiler-toggle' + (on ? ' on' : '') + (compact ? ' compact' : '')}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      title={on ? 'Marked as a spoiler' : 'Mark this comment as a spoiler'}
    >
      <Icon name={on ? 'visibility_off' : 'visibility'} /> Spoiler
    </button>
  )
}
