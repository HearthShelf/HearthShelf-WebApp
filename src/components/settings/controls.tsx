import type { ReactNode, CSSProperties } from 'react'

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
  return (
    <div className={'set-row' + (stacked ? ' set-row-stack' : '')}>
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

export function Toggle({
  on,
  onChange,
}: {
  on: boolean
  onChange: (v: boolean) => void
}) {
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
