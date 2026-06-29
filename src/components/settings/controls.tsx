import type { ReactNode } from 'react'

// Shared settings controls, mirroring the self-hosted Settings shell's small
// helpers. Used by Playback, Reading, Appearance, and Account sections so the
// SetRow / Seg / Toggle markup stays in one place.

// A label + description row with its control on the right.
export function SetRow({
  title,
  desc,
  control,
}: {
  title: ReactNode
  desc?: ReactNode
  control: ReactNode
}) {
  return (
    <div className="set-row">
      <div className="sr-meta">
        <div className="sr-t">{title}</div>
        {desc && <div className="sr-d">{desc}</div>}
      </div>
      {control}
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
