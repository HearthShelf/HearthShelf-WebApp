import type { ReactNode, CSSProperties } from 'react'
import { useSettingHighlight } from '@/hooks/useSettingHighlight'

// Shared settings controls, mirroring the self-hosted Settings shell's small
// helpers. Used by Playback, Reading, Appearance, and Account sections so the
// SetRow / Seg / Toggle markup stays in one place.

// A label + description row with its control on the right.
// Pass stacked=true + children to render the control below the label (for sliders).
export function SetRow({
  title,
  desc,
  control,
  stacked,
  children,
}: {
  title: ReactNode
  desc?: ReactNode
  control: ReactNode
  stacked?: boolean
  children?: ReactNode
}) {
  // Settings search flashes the row it sent you to.
  const { on: lit, ref } = useSettingHighlight(typeof title === 'string' ? title : undefined)

  return (
    <div
      ref={ref}
      className={'set-row' + (stacked ? ' set-row-stack' : '') + (lit ? ' set-row-lit' : '')}
    >
      <div className="sr-meta">
        <div className="sr-t">{title}</div>
        {desc && <div className="sr-d">{desc}</div>}
      </div>
      {!stacked && control}
      {stacked && children}
    </div>
  )
}

// A two-or-more option segmented control.
export function Seg<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          type="button"
          key={String(o.value)}
          className={'seg-btn' + (o.value === value ? ' on' : '')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={'toggle' + (on ? ' on' : '')}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <i />
    </button>
  )
}

/**
 * Multi-select chips for choosing WHICH delivery channels one notification type
 * uses. Unlike Seg (pick one of N) every chip toggles independently, because
 * these are not alternatives - a reaction can reasonably be push + in-app but
 * not email, which is the whole point of the control.
 *
 * A `disabled` chip still renders, greyed, carrying the reason as its title: a
 * channel switched off globally should look unavailable rather than silently
 * vanish, so "why isn't this reaching me" stays answerable from this screen.
 */
export function ChannelChips<T extends string>({
  options,
  selected,
  disabled,
  onToggle,
}: {
  options: { id: T; label: string }[]
  selected: Record<string, boolean>
  /** Channel ids that cannot be toggled here, mapped to why. */
  disabled?: Partial<Record<T, string>>
  onToggle: (id: T, next: boolean) => void
}) {
  return (
    <div className="channel-chips">
      {options.map((option) => {
        const on = Boolean(selected[option.id])
        const lock = disabled?.[option.id]
        return (
          <button
            key={option.id}
            type="button"
            // `on` and `lock` are independent: a locked chip may be locked
            // because it is forced ON (club invites always reach the tray) or
            // forced OFF (the channel is disabled globally). Showing every
            // locked chip as off would misreport what actually happens.
            className={'channel-chip' + (on ? ' on' : '') + (lock ? ' locked' : '')}
            role="checkbox"
            aria-checked={on}
            aria-disabled={Boolean(lock)}
            disabled={Boolean(lock)}
            title={lock || undefined}
            onClick={() => !lock && onToggle(option.id, !on)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

// A full-width slider that fills the row below the label (use with set-row-stack).
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  formatLabel,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  formatLabel?: (v: number) => string
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="set-slider-wrap">
      <input
        type="range"
        className="set-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="set-slider-val">{formatLabel ? formatLabel(value) : value}</span>
    </div>
  )
}

// A small number input for custom skip/rewind values.
export function NumberInput({
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  value: number
  min?: number
  max?: number
  suffix?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="set-num-wrap">
      <input
        type="number"
        className="set-num"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (!isNaN(n)) onChange(n)
        }}
      />
      {suffix && <span className="set-num-suffix">{suffix}</span>}
    </div>
  )
}
