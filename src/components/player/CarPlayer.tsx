import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSettingsStore } from '@/store/settingsStore'
import { useSleepTimer } from '@/hooks/useSleepTimer'
import { useIdleFade } from '@/hooks/useIdleFade'
import { useDraggableCard } from '@/hooks/useDraggableCard'
import { SpeedPopover, SleepPopover } from '@/components/player/PlayerPopovers'
import { formatTimestamp } from '@hearthshelf/core'
import { Cover } from '@/components/shared/Cover'
import { Icon } from '@/components/common/Icon'

interface Chap {
  id: number
  start: number
  end: number
  title: string
}

type Sheet = 'more' | 'speed' | 'sleep' | null

/**
 * Big-touch, glance-friendly player for in-car browsers. A draggable + resizable
 * card (sizing the card sizes the controls), with the core transport always
 * visible and everything else behind "More". After a minute idle, non-essential
 * chrome fades; the core transport stays. Skip controls keep the timer alive but
 * do NOT reveal the faded chrome.
 */
export function CarPlayer({
  libraryItemId,
  title,
  author,
  chapters,
  ci,
  cur,
  pos,
  duration,
  isPlaying,
  rate,
  setRate,
  togglePlay,
  seekClamp,
  prevCh,
  nextCh,
  onExit,
  idleMs = 60_000,
}: {
  libraryItemId: string
  title: string
  author: string
  chapters: Chap[]
  ci: number
  cur: Chap
  pos: number
  duration: number
  isPlaying: boolean
  rate: number
  setRate: (r: number) => void
  togglePlay: () => void
  seekClamp: (sec: number) => void
  prevCh: () => void
  nextCh: () => void
  onExit: () => void
  /** Idle timeout before chrome fades (ms). Defaults to one minute. */
  idleMs?: number
}) {
  const navigate = useNavigate()
  const skipFwd = useSettingsStore((s) => s.skipForward)
  const skipBack = useSettingsStore((s) => s.skipBack)
  const sleepCtl = useSleepTimer()

  const [sheet, setSheet] = useState<Sheet>(null)

  // Idle-fade: a "wake" reveals chrome + resets; "tick" only resets the timer.
  const { faded, wake, tick } = useIdleFade(true, idleMs)
  const { rect, onDragHandlePointerDown, onResizeHandlePointerDown, dragging } =
    useDraggableCard(true, wake)

  const bookRatio = duration > 0 ? pos / duration : 0

  const clickRatio = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  }

  // Skip controls must not bubble to the card's wake handler - otherwise a
  // nudge would reveal the faded chrome. They tick() (keep the timer alive)
  // via their own onClick instead.
  const stopWake = (e: React.PointerEvent) => e.stopPropagation()

  // Core transport reporters: skip controls tick (keep awake, no reveal);
  // play/pause is a full wake so chrome comes back when you start fiddling.
  const onPlay = () => {
    wake()
    togglePlay()
  }
  const onBack = () => {
    tick()
    seekClamp(pos - skipBack)
  }
  const onFwd = () => {
    tick()
    seekClamp(pos + skipFwd)
  }
  const onPrevCh = () => {
    tick()
    prevCh()
  }
  const onNextCh = () => {
    tick()
    nextCh()
  }

  const toggleSheet = (s: Exclude<Sheet, null>) => {
    wake()
    setSheet((c) => (c === s ? null : s))
  }

  return (
    <div
      className={
        'car-card' + (dragging ? ' dragging' : '') + (faded ? ' faded' : '')
      }
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onPointerDown={wake}
    >
      {/* Drag handle / header - hidden when faded. */}
      <div className="car-head" onPointerDown={onDragHandlePointerDown}>
        <span className="car-grip" aria-hidden>
          <Icon name="drag_indicator" />
        </span>
        <div className="car-head-meta">
          <div className="eyebrow">HearthShelf</div>
          <div className="car-ch">
            Ch {ci + 1} / {chapters.length || 1}
          </div>
        </div>
        <button
          className="car-icon-btn"
          title="Exit car mode"
          aria-label="Exit car mode"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onExit}
        >
          <Icon name="close_fullscreen" />
        </button>
      </div>

      <div className="car-body">
        <Cover
          itemId={libraryItemId}
          title={title}
          author={author || undefined}
          fs={22}
          className="car-cover"
        />

        <div className="car-titles">
          <div className="car-title">{title}</div>
          <div className="car-sub">{cur.title}</div>
        </div>

        {/* Big scrubber over the whole book. */}
        <div
          className="scrub seekable car-scrub"
          onClick={(e) => {
            wake()
            seekClamp(clickRatio(e) * duration)
          }}
        >
          <i style={{ width: bookRatio * 100 + '%' }} />
          <b style={{ left: bookRatio * 100 + '%' }} />
        </div>
        <div className="p-times car-times">
          <span>{formatTimestamp(pos)}</span>
          <span>-{formatTimestamp(duration - pos)}</span>
        </div>

        {/* Core transport - always visible, even when faded. The skip controls
            stop pointer propagation so they DON'T trigger the card's wake: you
            can nudge playback while idle without the chrome flashing back. */}
        <div className="car-transport">
          <button
            className="car-skip lite"
            title="Previous chapter"
            onPointerDown={stopWake}
            onClick={onPrevCh}
          >
            <Icon name="skip_previous" fill />
          </button>
          <button
            className="car-skip"
            title={`Back ${skipBack}s`}
            onPointerDown={stopWake}
            onClick={onBack}
          >
            <Icon name="replay" />
            <small>{skipBack}</small>
          </button>
          <button className="car-play" onClick={onPlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
            <Icon name={isPlaying ? 'pause' : 'play_arrow'} fill />
          </button>
          <button
            className="car-skip"
            title={`Forward ${skipFwd}s`}
            onPointerDown={stopWake}
            onClick={onFwd}
          >
            <Icon name="replay" style={{ transform: 'scaleX(-1)' }} />
            <small>{skipFwd}</small>
          </button>
          <button
            className="car-skip lite"
            title="Next chapter"
            onPointerDown={stopWake}
            onClick={onNextCh}
          >
            <Icon name="skip_next" fill />
          </button>
        </div>

        {/* Secondary row - the first thing to fade out. */}
        <div className="car-secondary">
          <button
            className={'car-pill' + (sheet === 'speed' ? ' on' : '')}
            onClick={() => toggleSheet('speed')}
          >
            <Icon name="speed" /> {rate}×
          </button>
          <button
            className={'car-pill' + (sheet === 'sleep' || sleepCtl.active ? ' on' : '')}
            onClick={() => toggleSheet('sleep')}
          >
            <Icon name="bedtime" />{' '}
            {sleepCtl.sleeping ? formatTimestamp(sleepCtl.left) : 'Sleep'}
          </button>
          <button
            className={'car-pill' + (sheet === 'more' ? ' on' : '')}
            onClick={() => toggleSheet('more')}
          >
            <Icon name="more_horiz" /> More
          </button>
        </div>
      </div>

      {/* Sheets - speed / sleep / more. Also fade with the chrome. */}
      {sheet && (
        <div className="car-sheet">
          {sheet === 'speed' && (
            <SpeedPopover speed={rate} setSpeed={setRate} onClose={() => setSheet(null)} />
          )}
          {sheet === 'sleep' && (
            <SleepPopover ctl={sleepCtl} onClose={() => setSheet(null)} />
          )}
          {sheet === 'more' && (
            <div className="car-more">
              <button
                className="car-more-item"
                onClick={() => {
                  setSheet(null)
                  navigate(`/book/${libraryItemId}`)
                }}
              >
                <Icon name="info" /> Book details
              </button>
              <button
                className="car-more-item"
                onClick={() => {
                  setSheet(null)
                  navigate(`/reader/${libraryItemId}`)
                }}
              >
                <Icon name="menu_book" /> Read along
              </button>
              <button className="car-more-item" onClick={onExit}>
                <Icon name="close_fullscreen" /> Exit car mode
              </button>
            </div>
          )}
        </div>
      )}

      {/* Resize grip - bottom-right corner. */}
      <span
        className="car-resize"
        onPointerDown={onResizeHandlePointerDown}
        aria-hidden
      >
        <Icon name="open_in_full" />
      </span>
    </div>
  )
}
