import { useEffect, useState } from 'react'
import { Play, Pause, RotateCcw, RotateCw, Moon, List, Gauge } from 'lucide-react'
import { usePlayer } from '@/player/PlayerProvider'
import type { AbsChapter } from '@/api/absLibrary'
import { cn } from '@/lib/cn'

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

const SPEEDS = [0.8, 1, 1.2, 1.5, 1.75, 2, 2.5, 3]
const SLEEP_OPTIONS = [15, 30, 45, 60]

/**
 * Audiobook transport: play/pause, +/-15s and +/-30s, whole-book scrubber with
 * chapter markers, current-chapter readout + chapter picker, playback speed,
 * and a sleep timer. Keyboard: space=play/pause, arrows=skip.
 */
export function AudioPlayer({
  chapters,
  totalDurationSec,
}: {
  chapters: AbsChapter[]
  totalDurationSec: number
}) {
  const {
    playing,
    positionSec,
    rate,
    setRate,
    togglePlay,
    seekTo,
    skip,
    setSleepMinutes,
    sleepArmed,
    sleepRemainingMs,
  } = usePlayer()

  const [showChapters, setShowChapters] = useState(false)
  const currentChapter = chapters.find((c) => positionSec >= c.startSec && positionSec < c.endSec)

  // Keyboard shortcuts (ignore while typing in an input).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowLeft') {
        skip(-15)
      } else if (e.key === 'ArrowRight') {
        skip(15)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, skip])

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      {currentChapter && (
        <p className="t-muted mb-2 line-clamp-1 text-[13px]">{currentChapter.title}</p>
      )}

      {/* Scrubber with chapter tick marks. */}
      <div className="relative">
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.floor(totalDurationSec))}
          value={Math.floor(positionSec)}
          onChange={(e) => seekTo(Number(e.target.value))}
          aria-label="Seek"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-elevated accent-primary"
        />
        {totalDurationSec > 0 &&
          chapters.map((c) => (
            <span
              key={c.id}
              className="pointer-events-none absolute top-1/2 h-2 w-px -translate-y-1/2 bg-muted-foreground/50"
              style={{ left: `${(c.startSec / totalDurationSec) * 100}%` }}
            />
          ))}
      </div>
      <div className="mt-2 flex justify-between">
        <span className="t-mono text-[12px] text-muted-foreground">{fmt(positionSec)}</span>
        <span className="t-mono text-[12px] text-muted-foreground">{fmt(totalDurationSec)}</span>
      </div>

      {/* Transport. */}
      <div className="mt-4 flex items-center justify-center gap-5">
        <button
          onClick={() => skip(-30)}
          aria-label="Back 30 seconds"
          className="flex items-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <RotateCcw size={20} />
          <span className="-ml-1 text-[10px] font-semibold">30</span>
        </button>
        <button
          onClick={() => skip(-15)}
          aria-label="Back 15 seconds"
          className="flex items-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <RotateCcw size={18} />
          <span className="-ml-1 text-[10px] font-semibold">15</span>
        </button>

        <button
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90"
        >
          {playing ? (
            <Pause size={24} fill="currentColor" />
          ) : (
            <Play size={24} fill="currentColor" />
          )}
        </button>

        <button
          onClick={() => skip(15)}
          aria-label="Forward 15 seconds"
          className="flex items-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <RotateCw size={18} />
          <span className="-ml-1 text-[10px] font-semibold">15</span>
        </button>
        <button
          onClick={() => skip(30)}
          aria-label="Forward 30 seconds"
          className="flex items-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <RotateCw size={20} />
          <span className="-ml-1 text-[10px] font-semibold">30</span>
        </button>
      </div>

      {/* Speed / sleep / chapters row. */}
      <div className="mt-5 flex items-center justify-center gap-2 border-t border-border pt-4">
        <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Gauge size={15} />
          <select
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            aria-label="Playback speed"
            className="rounded-md border border-input bg-background px-2 py-1 text-[13px] text-foreground"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
        </label>

        <SleepMenu armed={sleepArmed} remainingMs={sleepRemainingMs} onSet={setSleepMinutes} />

        {chapters.length > 0 && (
          <button
            onClick={() => setShowChapters((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border border-input px-2 py-1 text-[13px]',
              showChapters ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground',
            )}
          >
            <List size={15} />
            Chapters
          </button>
        )}
      </div>

      {showChapters && chapters.length > 0 && (
        <ul className="mt-4 max-h-64 overflow-y-auto rounded-lg border border-border">
          {chapters.map((c) => {
            const active = currentChapter?.id === c.id
            return (
              <li key={c.id}>
                <button
                  onClick={() => seekTo(c.startSec)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] transition-colors hover:bg-accent',
                    active && 'bg-secondary',
                  )}
                >
                  <span className="line-clamp-1 text-card-foreground">{c.title}</span>
                  <span className="t-mono shrink-0 text-[12px] text-muted-foreground">
                    {fmt(c.startSec)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function SleepMenu({
  armed,
  remainingMs,
  onSet,
}: {
  armed: boolean
  remainingMs: number | null
  onSet: (minutes: number | null) => void
}) {
  const [open, setOpen] = useState(false)
  const mins = remainingMs != null ? Math.ceil(remainingMs / 60_000) : null
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 rounded-md border border-input px-2 py-1 text-[13px]',
          armed ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground',
        )}
      >
        <Moon size={15} />
        {armed && mins != null ? `${mins}m` : 'Sleep'}
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 rounded-lg border border-border bg-card p-1 shadow-xl">
          {SLEEP_OPTIONS.map((m) => (
            <button
              key={m}
              onClick={() => {
                onSet(m)
                setOpen(false)
              }}
              className="block w-full whitespace-nowrap rounded px-3 py-1.5 text-left text-[13px] text-card-foreground hover:bg-accent"
            >
              {m} minutes
            </button>
          ))}
          {armed && (
            <button
              onClick={() => {
                onSet(null)
                setOpen(false)
              }}
              className="block w-full rounded px-3 py-1.5 text-left text-[13px] text-destructive hover:bg-accent"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  )
}
