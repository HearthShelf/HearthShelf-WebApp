import { Link } from 'react-router-dom'
import { Play, Pause, RotateCcw, RotateCw, BookOpen } from 'lucide-react'
import { usePlayer } from '@/player/PlayerProvider'

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`
}

/**
 * Docked mini-player in the app shell. Visible whenever something is loaded, so
 * playback (and its controls) persist across navigation. The cover/title link
 * back to the full item page; the scrubber + transport drive the global player.
 */
export function MiniPlayer() {
  const p = usePlayer()
  if (!p.now) return null
  const n = p.now
  const itemHref = `/book/${n.itemId}`

  return (
    <div className="border-t border-border bg-sidebar">
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.floor(n.totalDurationSec))}
        value={Math.floor(p.positionSec)}
        onChange={(e) => p.seekTo(Number(e.target.value))}
        aria-label="Seek"
        className="block h-1 w-full cursor-pointer appearance-none bg-elevated accent-primary"
      />
      <div className="flex items-center gap-3 px-4 py-2">
        <Link to={itemHref} className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-secondary">
            {n.coverUrl ? (
              <img src={n.coverUrl} alt="" className="size-full object-cover" />
            ) : (
              <BookOpen size={16} className="text-muted-foreground" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-card-foreground">
              {n.title}
            </span>
            {n.author && (
              <span className="block truncate text-[12px] text-muted-foreground">{n.author}</span>
            )}
          </span>
        </Link>

        <span className="t-mono hidden text-[12px] text-muted-foreground sm:block">
          {fmt(p.positionSec)} / {fmt(n.totalDurationSec)}
        </span>

        <div className="flex items-center gap-1">
          <button
            onClick={() => p.skip(-15)}
            aria-label="Back 15 seconds"
            className="flex items-center text-muted-foreground transition-colors hover:text-foreground"
          >
            <RotateCcw size={18} />
          </button>
          <button
            onClick={p.togglePlay}
            aria-label={p.playing ? 'Pause' : 'Play'}
            className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90"
          >
            {p.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button
            onClick={() => p.skip(15)}
            aria-label="Forward 15 seconds"
            className="flex items-center text-muted-foreground transition-colors hover:text-foreground"
          >
            <RotateCw size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
