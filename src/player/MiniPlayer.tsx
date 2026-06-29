import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { usePlayer } from '@/player/PlayerProvider'
import { useSettingsStore } from '@/store/settingsStore'
import { useSleepTimer } from '@/hooks/useSleepTimer'
import { Icon } from '@/components/common/Icon'
import { Cover } from '@/components/shared/Cover'
import { SpeedPopover, SleepPopover } from '@/components/player/PlayerPopovers'
import { formatTimestamp } from '@/lib/format'

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
  const {
    now,
    playing,
    positionSec,
    togglePlay,
    seekTo,
    skip,
    rate,
    setRate,
  } = usePlayer()

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
  const localPos = Math.max(0, currentTime - offset)
  const pct = span > 0 ? Math.min(100, (localPos / span) * 100) : 0

  const onScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (span <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
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

  return (
    <div className={'playbar' + (onPlayerRoute ? ' hidden' : '')}>
      <div
        className="pb-now"
        onClick={() => navigate(`/book/${now.itemId}`)}
        style={{ cursor: 'pointer' }}
      >
        <Cover itemId={now.itemId} title={now.title} author={now.author} fs={5} />
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
          <button
            className="pb-play"
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
          >
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
          <span>{formatTimestamp(localPos)}</span>
          <div className="scrub" onClick={onScrub}>
            <i style={{ width: pct + '%' }} />
            <b style={{ left: pct + '%' }} />
          </div>
          <span>-{formatTimestamp(Math.max(0, span - localPos))}</span>
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
