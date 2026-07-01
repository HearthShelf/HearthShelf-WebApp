import { useState, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { usePlayer } from '@/player/PlayerProvider'
import { useSettingsStore } from '@/store/settingsStore'
import { useSleepTimer } from '@/hooks/useSleepTimer'
import { Icon } from '@/components/common/Icon'
import { tintFor } from '@/components/shared/Cover'
import { SpeedPopover, SleepPopover } from '@/components/player/PlayerPopovers'
import { Scrubber } from '@/components/player/Scrubber'
import { formatTimestamp } from '@hearthshelf/core'

type Pop = 'speed' | 'sleep' | 'chapters' | null

/**
 * Docked mini-player in the app shell. Rendered once by AppShell and never
 * unmounted on navigation, so playback (and its controls) persist across routes.
 * Hidden (per the design) until a playback session exists.
 *
 * This drives the global player from @/player/PlayerProvider:
 *  - title/author/cover/chapters/duration come from `now`
 *  - position/playing/rate and the transport actions come from the hook
 *
 * Parity gaps vs. the self-hosted PlayerBar (intentional):
 *  - Volume: PlayerProvider does not expose volume, so the volume popover is omitted.
 *  - Bookmarks/Queue panels + panel pre-select: the WebApp player has no
 *    requestPanel store, so the expand button just opens /player.
 */
export function MiniPlayer() {
  const { now, close, playing, positionSec, togglePlay, seekTo, skip, rate, setRate } = usePlayer()

  // Swipe-to-dismiss: drag the bar horizontally; past the threshold on release it
  // dismisses (which stops playback). Tracked in a ref during the gesture and
  // mirrored to state only for the live transform, so we don't thrash renders.
  const swipeStartX = useRef<number | null>(null)
  const [dragX, setDragX] = useState(0)
  const DISMISS_PX = 90
  // Live scrubber drag target (0-1, null when not dragging) so the time
  // labels preview where you're scrubbing to.
  const [scrubDrag, setScrubDrag] = useState<number | null>(null)

  const onTouchStart = (e: React.TouchEvent) => {
    swipeStartX.current = e.touches[0].clientX
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (swipeStartX.current == null) return
    setDragX(e.touches[0].clientX - swipeStartX.current)
  }
  const onTouchEnd = () => {
    if (Math.abs(dragX) > DISMISS_PX) {
      close()
    }
    swipeStartX.current = null
    setDragX(0)
  }

  const scrubber = useSettingsStore((s) => s.scrubber)
  const skipFwd = useSettingsStore((s) => s.skipForward)
  const skipBack = useSettingsStore((s) => s.skipBack)
  const sleepCtl = useSleepTimer()
  const navigate = useNavigate()
  const onPlayerRoute = useLocation().pathname === '/player'

  const [pop, setPop] = useState<Pop>(null)
  const togglePop = (k: Pop) => setPop((c) => (c === k ? null : k))

  if (!now || !now.title) return null

  const chapters = now.chapters
  const duration = now.totalDurationSec
  const currentTime = positionSec

  // Current chapter index from the play position (first chapter we haven't passed).
  let curIdx = -1
  if (chapters.length > 0) {
    curIdx = chapters.findIndex((c) => currentTime < c.endSec)
    if (curIdx === -1) curIdx = chapters.length - 1
  }

  // The scrubber tracks either the whole book or the current chapter, per the
  // Settings "scrubber" preference - matching the full player.
  let cur = { start: 0, end: duration }
  if (curIdx !== -1) {
    cur = { start: chapters[curIdx].startSec, end: chapters[curIdx].endSec }
  }
  const useChapter = scrubber === 'chapter' && chapters.length > 0
  const span = useChapter ? cur.end - cur.start : duration
  const offset = useChapter ? cur.start : 0
  // While dragging the scrubber, the labels preview the drag target.
  const localPos = scrubDrag === null ? Math.max(0, currentTime - offset) : scrubDrag * span
  const pct = span > 0 ? Math.min(100, (localPos / span) * 100) : 0

  const onScrub = (ratio: number) => {
    if (span <= 0) return
    seekTo(offset + ratio * span)
  }

  // chapterStep is not provided by PlayerProvider; implement it locally by
  // seeking to the start of the previous/next chapter relative to where we are.
  const chapterStep = (dir: -1 | 1) => {
    if (chapters.length === 0 || curIdx === -1) return
    if (dir === -1) {
      // If we're more than a moment into the current chapter, restart it;
      // otherwise jump to the previous chapter's start.
      const atStart = currentTime - chapters[curIdx].startSec < 2
      const target = atStart ? Math.max(0, curIdx - 1) : curIdx
      seekTo(chapters[target].startSec)
    } else {
      const target = Math.min(chapters.length - 1, curIdx + 1)
      seekTo(chapters[target].startSec)
    }
  }

  const dragging = dragX !== 0

  return (
    <div
      className={'playbar' + (onPlayerRoute ? ' hidden' : '')}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={
        dragging
          ? {
              transform: `translateX(${dragX}px)`,
              opacity: Math.max(0.3, 1 - Math.abs(dragX) / 240),
              transition: 'none',
            }
          : undefined
      }
    >
      <div className="pb-now" onClick={() => navigate('/player')} style={{ cursor: 'pointer' }}>
        {/* The mini-player is global chrome mounted OUTSIDE the MediaUI provider,
            so it can't use <Cover> (which reads useMediaUI). The now-playing
            descriptor already carries a tokenized coverUrl captured at load. */}
        <span className="cover pb-cover" style={{ ['--cv' as string]: tintFor(now.title) }}>
          {now.coverUrl ? (
            <img className="cv-img" src={now.coverUrl} alt={now.title} />
          ) : (
            <span className="cv-mono" aria-hidden>
              {(now.title || '?').trim()[0]}
            </span>
          )}
        </span>
        <div className="pb-meta">
          <div className="pb-title">{now.title}</div>
          <div className="pb-sub">{now.author}</div>
        </div>
      </div>

      <div className="pb-center">
        <div className="pb-controls">
          <button
            className="pb-skip"
            onClick={() => chapterStep(-1)}
            aria-label="Previous chapter"
            disabled={chapters.length === 0}
          >
            <Icon name="skip_previous" fill />
          </button>
          <button
            className="pb-skip"
            onClick={() => skip(-skipBack)}
            aria-label={`Back ${skipBack} seconds`}
          >
            <Icon name="replay" />
            <small>{skipBack}</small>
          </button>
          <button className="pb-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
            <Icon name={playing ? 'pause' : 'play_arrow'} fill />
          </button>
          <button
            className="pb-skip"
            onClick={() => skip(skipFwd)}
            aria-label={`Forward ${skipFwd} seconds`}
          >
            <Icon name="replay" className="mirror" />
            <small>{skipFwd}</small>
          </button>
          <button
            className="pb-skip"
            onClick={() => chapterStep(1)}
            aria-label="Next chapter"
            disabled={chapters.length === 0}
          >
            <Icon name="skip_next" fill />
          </button>
        </div>
        <div className="pb-time">
          <Scrubber
            className="scrub"
            ratio={pct / 100}
            onDrag={setScrubDrag}
            onSeek={onScrub}
            elapsed={formatTimestamp(localPos)}
            remain={'-' + formatTimestamp(Math.max(0, span - localPos))}
          />
        </div>
      </div>

      <div className="pb-right">
        <div className="pb-pop-wrap">
          {pop === 'speed' && (
            <div className="p-pop pb-pop">
              <SpeedPopover speed={rate} setSpeed={setRate} onClose={() => setPop(null)} />
            </div>
          )}
          <button
            className={'pill' + (pop === 'speed' ? ' on' : '')}
            onClick={() => togglePop('speed')}
          >
            {rate}×
          </button>
        </div>

        <div className="pb-pop-wrap">
          {pop === 'chapters' && (
            <div
              className="p-pop pb-pop"
              style={{ width: 340, maxHeight: '70vh', overflowY: 'auto' }}
            >
              <div className="pop-head">
                <Icon name="list" /> Chapters
                <span className="pop-x" onClick={() => setPop(null)}>
                  <Icon name="close" style={{ fontSize: 18 }} />
                </span>
              </div>
              <div
                className="chap-list"
                style={{
                  maxHeight: 420,
                  overflowY: 'auto',
                  border: '1px solid var(--hairline)',
                  borderRadius: 'var(--r-card)',
                  padding: 6,
                }}
              >
                {chapters.map((c, i) => (
                  <button
                    type="button"
                    className={'chap' + (i === curIdx ? ' now' : '')}
                    key={c.id}
                    onClick={() => {
                      seekTo(c.startSec)
                      setPop(null)
                    }}
                  >
                    <span className="n">{i + 1}</span>
                    <span className="ct">{c.title}</span>
                    <span className="cd">{formatTimestamp(c.startSec)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <button
            className={'icon-btn' + (pop === 'chapters' ? ' on' : '')}
            title="Chapters"
            onClick={() => togglePop('chapters')}
            disabled={chapters.length === 0}
          >
            <Icon name="list" />
          </button>
        </div>

        <div className="pb-pop-wrap">
          {pop === 'sleep' && (
            <div className="p-pop pb-pop" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <SleepPopover ctl={sleepCtl} onClose={() => setPop(null)} />
            </div>
          )}
          <button
            className={'icon-btn' + (pop === 'sleep' || sleepCtl.active ? ' on' : '')}
            title="Sleep timer"
            onClick={() => togglePop('sleep')}
          >
            <Icon name="bedtime" />
          </button>
        </div>

        <button
          className="icon-btn"
          title="Now playing"
          aria-label="Open full player"
          onClick={() => {
            setPop(null)
            navigate('/player')
          }}
        >
          <Icon name="open_in_full" />
        </button>
      </div>
    </div>
  )
}
