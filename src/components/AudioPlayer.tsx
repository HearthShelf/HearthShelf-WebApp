import { Play, Pause, RotateCcw, RotateCw } from 'lucide-react'
import { useAudioPlayer } from '@/hooks/useAudioPlayer'
import type { AbsTrack } from '@/api/absLibrary'

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * Audiobook transport: play/pause, +/-15s and +/-30s skips, and a scrubber over
 * the whole book (across tracks). Position + progress save are handled by
 * useAudioPlayer; this is the presentation + controls.
 */
export function AudioPlayer({
  tracks,
  totalDurationSec,
  startAtSec,
  onSaveProgress,
}: {
  tracks: AbsTrack[]
  totalDurationSec: number
  startAtSec: number
  onSaveProgress: (currentTimeSec: number) => void
}) {
  const { playing, positionSec, togglePlay, seekTo, skip } = useAudioPlayer({
    tracks,
    totalDurationSec,
    startAtSec,
    onSaveProgress,
  })

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.floor(totalDurationSec))}
          value={Math.floor(positionSec)}
          onChange={(e) => seekTo(Number(e.target.value))}
          aria-label="Seek"
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-elevated accent-primary"
        />
      </div>
      <div className="mt-2 flex justify-between">
        <span className="t-mono text-[12px] text-muted-foreground">{fmt(positionSec)}</span>
        <span className="t-mono text-[12px] text-muted-foreground">{fmt(totalDurationSec)}</span>
      </div>

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
          {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
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
    </div>
  )
}
