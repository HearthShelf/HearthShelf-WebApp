import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSettingsStore } from '@/store/settingsStore'
import { useSleepTimer } from '@/hooks/useSleepTimer'
import { useDraggableCard } from '@/hooks/useDraggableCard'
import { Scrubber } from '@/components/player/Scrubber'
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
 * Car mode's player: a big-touch, glance-friendly card for in-car browsers. A
 * draggable + resizable card (sizing the card sizes the controls), with the
 * core transport always visible and everything else behind "More". After 30s
 * idle, non-essential chrome fades; the core transport stays. Skip controls
 * keep the timer alive but do NOT reveal the faded chrome.
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
  scrubber,
  faded,
  wake,
  tick,
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
  /** Whether the scrubber tracks the current chapter or the whole book - the
   * Settings > Playback "Progress bar" preference, same as the desktop/mini
   * player. */
  scrubber: 'chapter' | 'book'
  /** Idle-fade state, owned by the caller (PlayerPage) so the hearth
   * background behind the card can also wake the chrome on tap. */
  faded: boolean
  wake: () => void
  tick: () => void
}) {
  const navigate = useNavigate()
  const skipFwd = useSettingsStore((s) => s.skipForward)
  const skipBack = useSettingsStore((s) => s.skipBack)
  const sleepCtl = useSleepTimer()

  const [sheet, setSheet] = useState<Sheet>(null)
  // While the scrubber is being dragged, the time labels preview the drag
  // target instead of the live play position (null = not dragging).
  const [dragRatio, setDragRatio] = useState<number | null>(null)

  const { rect, onDragHandlePointerDown, onResizeHandlePointerDown, dragging } =
    useDraggableCard(true, wake)

  const chSpan = Math.max(1, cur.end - cur.start)
  // The absolute book position shown in the labels: the drag target while
  // dragging, otherwise the live play position.
  const previewPos =
    dragRatio === null
      ? pos
      : scrubber === 'chapter'
        ? cur.start + dragRatio * chSpan
        : dragRatio * duration
  const bookRatio = duration > 0 ? previewPos / duration : 0
  const chPos = Math.max(0, Math.min(chSpan, previewPos - cur.start))
  const chRatio = chPos / chSpan
  const scrubRatio = scrubber === 'chapter' ? chRatio : bookRatio

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

        {/* Big scrubber - chapter or whole book, per the scrubber setting. */}
        <Scrubber
          className="scrub car-scrub"
          ratio={scrubRatio}
          onDrag={(r) => {
            wake()
            setDragRatio(r)
          }}
          onSeek={(r) => {
            wake()
            seekClamp(scrubber === 'chapter' ? cur.start + r * chSpan : r * duration)
          }}
          elapsed={formatTimestamp(scrubber === 'chapter' ? chPos : previewPos)}
          chapter={`Ch ${ci + 1} / ${chapters.length || 1}`}
          remain={
            '-' + formatTimestamp(scrubber === 'chapter' ? chSpan - chPos : duration - previewPos)
          }
        />

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
