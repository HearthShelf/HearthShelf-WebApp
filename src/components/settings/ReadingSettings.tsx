import {
  useReaderPrefs,
  READER_SIZE_MIN,
  READER_SIZE_MAX,
  type ReaderTheme,
  type ReaderFont,
  type ReaderWidth,
  type ReaderLh,
  type ReaderLayout,
} from '@/store/readerPrefsStore'
import { Icon } from '@/components/common/Icon'

function SetRow({
  title,
  desc,
  control,
}: {
  title: string
  desc?: string
  control: React.ReactNode
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

function Seg<T extends string | number>({
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

export function ReadingSettings() {
  const p = useReaderPrefs()
  const set = p.set

  return (
    <section>
      <div className="section-head">
        <Icon name="menu_book" />
        <h2>Reading</h2>
      </div>
      <p className="t-muted mb-4 text-[13px]">
        Defaults for the in-browser ebook reader. You can also tweak these live
        while reading.
      </p>

      <SetRow
        title="Theme"
        control={
          <Seg<ReaderTheme>
            value={p.theme}
            onChange={(v) => set('theme', v)}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'sepia', label: 'Sepia' },
              { value: 'paper', label: 'Paper' },
              { value: 'light', label: 'Light' },
            ]}
          />
        }
      />

      <SetRow
        title="Typeface"
        control={
          <Seg<ReaderFont>
            value={p.font}
            onChange={(v) => set('font', v)}
            options={[
              { value: 'serif', label: 'Serif' },
              { value: 'sans', label: 'Sans' },
              { value: 'dyslexic', label: 'Dyslexic' },
            ]}
          />
        }
      />

      <SetRow
        title="Text size"
        desc={`${p.size}px`}
        control={
          <input
            type="range"
            min={READER_SIZE_MIN}
            max={READER_SIZE_MAX}
            value={p.size}
            onChange={(e) => set('size', Number(e.target.value))}
            aria-label="Text size"
            className="h-1 w-40 cursor-pointer appearance-none rounded bg-elevated accent-primary"
          />
        }
      />

      <SetRow
        title="Line spacing"
        control={
          <Seg<ReaderLh>
            value={p.lh}
            onChange={(v) => set('lh', v)}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'normal', label: 'Normal' },
              { value: 'relaxed', label: 'Relaxed' },
            ]}
          />
        }
      />

      <SetRow
        title="Page width"
        control={
          <Seg<ReaderWidth>
            value={p.width}
            onChange={(v) => set('width', v)}
            options={[
              { value: 'narrow', label: 'Narrow' },
              { value: 'medium', label: 'Medium' },
              { value: 'wide', label: 'Wide' },
            ]}
          />
        }
      />

      <SetRow
        title="Layout"
        desc="Scroll continuously, or turn pages."
        control={
          <Seg<ReaderLayout>
            value={p.layout}
            onChange={(v) => set('layout', v)}
            options={[
              { value: 'scroll', label: 'Scroll' },
              { value: 'paged', label: 'Paged' },
            ]}
          />
        }
      />
    </section>
  )
}
