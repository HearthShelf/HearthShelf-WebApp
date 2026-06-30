import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { usePlayer } from '@/player/PlayerProvider'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useSettingsStore } from '@/store/settingsStore'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useSleepTimer } from '@/hooks/useSleepTimer'
import { SpeedPopover, SleepPopover } from '@/components/player/PlayerPopovers'
import { RecentListens } from '@/components/player/RecentListens'
import { MobilePlayer } from '@/components/player/MobilePlayer'
import { CarPlayer } from '@/components/player/CarPlayer'
import { useCarMode } from '@/hooks/useCarMode'
import { useBookmarks } from '@/hooks/useBookmarks'
import { useToast } from '@/hooks/useToast'
import { useQueueStore, type QueueMode, type AutoRuleId } from '@/store/queueStore'
import { getItemDetail, type AbsChapter, type AbsTarget } from '@/api/absLibrary'
import { formatTimestamp, stripHtml } from '@hearthshelf/core'
import { Cover } from '@/components/shared/Cover'
import { Icon } from '@/components/common/Icon'
import cozyHearth from '@/assets/img/SittingInTheHearth.webp'

// A chapter normalized to start/end seconds for the player's local math.
interface Chap {
  id: number
  start: number
  end: number
  title: string
}

type Panel = 'chapters' | 'details' | 'queue' | 'reader' | null
type Pop = 'speed' | 'sleep' | 'bookmark' | 'recent' | null

function PanelHead({
  icon,
  title,
  sub,
  onClose,
}: {
  icon: string
  title: string
  sub?: string
  onClose: () => void
}) {
  return (
    <div className="pp-head">
      <Icon name={icon} />
      <div className="pp-htext">
        <div className="pp-title">{title}</div>
        {sub && <div className="pp-sub">{sub}</div>}
      </div>
      <button className="icon-btn" onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  )
}

function ChaptersPanel({
  chapters,
  curIdx,
  onSeek,
  onClose,
}: {
  chapters: Chap[]
  curIdx: number
  onSeek: (start: number) => void
  onClose: () => void
}) {
  const left = chapters.length - curIdx
  return (
    <div className="pp-inner">
      <PanelHead
        icon="list"
        title="Chapters"
        sub={`${chapters.length} chapters · ${left} left`}
        onClose={onClose}
      />
      <div className="chap-list pp-scroll">
        {chapters.map((c, i) => {
          const isNow = i === curIdx
          const done = i < curIdx
          return (
            <div
              className={'chap' + (isNow ? ' now' : '') + (done ? ' done' : '')}
              key={c.id}
              style={{ cursor: 'pointer' }}
              onClick={() => onSeek(c.start)}
            >
              <span className="n">
                {isNow ? (
                  <Icon name="graphic_eq" fill style={{ fontSize: 16 }} />
                ) : done ? (
                  <Icon name="check" style={{ fontSize: 15 }} />
                ) : (
                  i + 1
                )}
              </span>
              <span className="ct">{c.title}</span>
              <span className="cd">{formatTimestamp(c.end - c.start)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const QUEUE_MODES: { v: QueueMode; l: string }[] = [
  { v: 'off', l: 'Off' },
  { v: 'manual', l: 'Manual' },
  { v: 'auto', l: 'Auto' },
  { v: 'playlist', l: 'Playlist' },
]
const QUEUE_MODE_SUB: Record<QueueMode, string> = {
  off: 'Playback stops when this book ends.',
  manual: 'Your hand-picked order — drag to arrange.',
  auto: "Filled automatically from what you're listening to.",
  playlist: 'Playing in order from a saved list.',
}
const RULE_COPY: Record<AutoRuleId, { label: string; desc: string }> = {
  'finish-series': {
    label: 'Finish the current series',
    desc: "Queue the next book whenever you're part-way through a series.",
  },
  'in-progress': {
    label: 'Anything in progress',
    desc: 'Keep going with books you already started.',
  },
  'new-in-series': {
    label: 'New books in a series',
    desc: "Suggest the first unread book in any series you've started.",
  },
}

function QueuePanel({
  nowId,
  nowTitle,
  nowAuthor,
  onClose,
  onPlay,
}: {
  nowId: string
  nowTitle: string
  nowAuthor: string
  onClose: () => void
  onPlay: (id: string) => void
}) {
  const items = useQueueStore((s) => s.items)
  const remove = useQueueStore((s) => s.remove)
  const reorder = useQueueStore((s) => s.reorder)
  const setQueueMode = useQueueStore((s) => s.setMode)
  const queueMode = useSettingsStore((s) => s.queueMode)
  const setSetting = useSettingsStore((s) => s.set)
  const autoRules = useSettingsStore((s) => s.queueAutoRules)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [showRules, setShowRules] = useState(false)

  const setMode = (v: QueueMode) => {
    setSetting('queueMode', v)
    setQueueMode(v)
  }
  const toggleRule = (id: AutoRuleId) =>
    setSetting(
      'queueAutoRules',
      autoRules.map((r) => (r.id === id ? { ...r, on: !r.on } : r))
    )

  const panelSub = queueMode === 'manual'
    ? `${items.length + 1} in queue · drag to reorder`
    : `${items.length + 1} in queue`

  return (
    <div className="pp-inner">
      <PanelHead icon="reorder" title="Up next" sub={panelSub} onClose={onClose} />

      <div style={{ padding: '8px 20px 0' }}>
        <div
          style={{
            display: 'flex',
            gap: 4,
            background: 'var(--fill)',
            border: '1px solid var(--hairline)',
            borderRadius: 999,
            padding: 4,
          }}
        >
          {QUEUE_MODES.map((m) => (
            <button
              key={m.v}
              className={'mp-seg' + (queueMode === m.v ? ' on' : '')}
              onClick={() => setMode(m.v)}
              style={{ flex: 1 }}
            >
              {m.l}
            </button>
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '8px 4px 12px',
          }}
        >
          <span style={{ fontSize: 11.5, lineHeight: 1.4, color: 'var(--text-muted)' }}>
            {QUEUE_MODE_SUB[queueMode]}
          </span>
          {queueMode === 'auto' && (
            <button
              className={'pill' + (showRules ? ' on' : '')}
              style={{ flex: 'none', fontSize: 12 }}
              onClick={() => setShowRules((s) => !s)}
            >
              <Icon name="tune" style={{ fontSize: 15 }} /> Auto rules
            </button>
          )}
        </div>
        {queueMode === 'auto' && showRules && (
          <div style={{ marginBottom: 12 }}>
            {autoRules.map((r) => {
              const copy = RULE_COPY[r.id]
              return (
                <div
                  key={r.id}
                  className="pop-row"
                  onClick={() => toggleRule(r.id)}
                  style={{ cursor: 'pointer', padding: '8px 4px', gap: 12 }}
                >
                  <div className="pr-t" style={{ flex: 1 }}>
                    {copy.label}
                    <div className="pr-d">{copy.desc}</div>
                  </div>
                  <div className={'toggle' + (r.on ? ' on' : '')}>
                    <i />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="pp-scroll">
        <div className="queue-row now">
          <span className="q-handle" style={{ opacity: 0.35, cursor: 'default' }}>
            <Icon name="graphic_eq" fill />
          </span>
          <Cover itemId={nowId} title={nowTitle} fs={3} />
          <div className="q-meta">
            <div className="q-t">{nowTitle}</div>
            <div className="q-s">Now playing · {nowAuthor}</div>
          </div>
        </div>
        {queueMode === 'off' ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: 8,
              padding: '32px 20px',
              color: 'var(--text-muted)',
            }}
          >
            <Icon name="do_not_disturb_on" style={{ fontSize: 36, opacity: 0.5 }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
              Nothing queued
            </div>
            <div style={{ fontSize: 12, maxWidth: 240, lineHeight: 1.45 }}>
              Playback stops when this book ends. Switch to Manual or Auto to keep going.
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="pop-empty" style={{ marginTop: 12 }}>
            Nothing queued. Add books with "Add to list".
          </div>
        ) : (
          items.map((q, i) => (
            <div
              className={'queue-row' + (dragIdx === i ? ' dragging' : '')}
              key={q.libraryItemId}
              draggable={queueMode === 'manual'}
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIdx !== null && dragIdx !== i) reorder(dragIdx, i)
                setDragIdx(null)
              }}
              onDragEnd={() => setDragIdx(null)}
            >
              <span
                className="q-handle"
                title={queueMode === 'manual' ? 'Drag to reorder' : undefined}
                style={queueMode !== 'manual' ? { opacity: 0.3, cursor: 'default' } : undefined}
              >
                <Icon name="drag_indicator" />
              </span>
              <Cover itemId={q.libraryItemId} title={q.title} fs={3} />
              <div
                className="q-meta"
                style={{ cursor: 'pointer' }}
                onClick={() => onPlay(q.libraryItemId)}
              >
                <div className="q-t">{q.title}</div>
                <div className="q-s">{q.author}</div>
              </div>
              <span
                className="bm-x"
                title="Remove"
                onClick={() => remove(q.libraryItemId)}
              >
                <Icon name="close" />
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/**
 * Full-screen, immersive now-playing view. The shell hides the AppBar on
 * /player. Drives the single global player (usePlayer): cover, transport,
 * scrubber, chapters, speed, sleep timer, bookmarks, recent listens, queue, and
 * a book-details panel.
 */
export function PlayerPage() {
  const navigate = useNavigate()
  const ui = useMediaUI()
  const { target } = useActiveServer()
  const {
    now,
    playing,
    positionSec,
    togglePlay,
    seekTo,
    rate,
    setRate,
  } = usePlayer()

  const libraryItemId = now?.itemId ?? null
  const title = now?.title ?? ''
  const author = now?.author ?? ''
  const duration = now?.totalDurationSec ?? 0
  const rawChapters = now?.chapters ?? []
  const speed = rate
  const setSpeed = setRate
  const pos = positionSec
  const isPlaying = playing

  const skipFwd = useSettingsStore((s) => s.skipForward)
  const skipBack = useSettingsStore((s) => s.skipBack)
  const scrubber = useSettingsStore((s) => s.scrubber)
  const hearthBgPlayer = useSettingsStore((s) => s.hearthBgPlayer)
  const isMobile = useIsMobile()
  const carMode = useCarMode()
  const setSetting = useSettingsStore((s) => s.set)

  // Full sleep-timer controller (three modes + stop behaviours).
  const sleepCtl = useSleepTimer()

  const [panel, setPanel] = useState<Panel>(null)
  const [pop, setPop] = useState<Pop>(null)
  const { toast, show: setToast } = useToast()

  const { bookmarks, addBookmark: addBookmarkApi, removeBookmark } =
    useBookmarks(libraryItemId)

  // Full metadata for the details panel (narrator, year, genre, series,
  // description) - the player descriptor only carries title/author/duration.
  const { data: detail } = useQuery({
    queryKey: ['abs-item', target?.serverId, libraryItemId],
    queryFn: () => getItemDetail(target as AbsTarget, libraryItemId as string),
    enabled: Boolean(target) && Boolean(libraryItemId),
    staleTime: 5 * 60 * 1000,
  })

  // Normalize chapters to start/end seconds for the local math.
  const chapters = useMemo<Chap[]>(
    () => rawChapters.map((c: AbsChapter) => ({ id: c.id, start: c.startSec, end: c.endSec, title: c.title })),
    [rawChapters]
  )

  // Reset player-only UI when the book CHANGES (not on first mount).
  const firstSession = useRef(true)
  useEffect(() => {
    if (firstSession.current) {
      firstSession.current = false
      return
    }
    setPanel(null)
    setPop(null)
  }, [libraryItemId])

  // Derived chapter position
  const { ci, cur } = useMemo(() => {
    if (chapters.length === 0)
      return { ci: 0, cur: { id: 0, start: 0, end: duration, title: 'Full book' } as Chap }
    let idx = chapters.findIndex((b) => pos < b.end)
    if (idx === -1) idx = chapters.length - 1
    return { ci: idx, cur: chapters[idx] }
  }, [chapters, pos, duration])

  // Keyboard shortcuts (player route only)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement
      )
        return
      if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowLeft') {
        seekTo(Math.max(0, pos - skipBack))
      } else if (e.key === 'ArrowRight') {
        seekTo(Math.min(duration, pos + skipFwd))
      } else if (e.key === 'Escape') {
        setPanel(null)
        setPop(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [togglePlay, seekTo, pos, duration, skipBack, skipFwd])

  if (!now || !libraryItemId) {
    return (
      <div className="page fade-in cozy-page">
        <div
          className="cozy-bg"
          aria-hidden="true"
          style={{ backgroundImage: `url("${cozyHearth}")` }}
        />
        <div className="cozy-veil" aria-hidden="true" />
        <div className="cozy-empty">
          <div className="eyebrow">By the hearth</div>
          <h1 className="cozy-h">Nothing playing</h1>
          <p className="cozy-sub">
            The fire's lit and the chair's yours. Pull something off the shelf and
            settle in.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/library')}>
            <Icon name="auto_stories" fill /> Browse the library
          </button>
        </div>
      </div>
    )
  }

  // Mobile gets the dedicated full-screen Shelf-Queue player; desktop keeps the
  // two-pane immersive layout below.
  if (isMobile) {
    return (
      <>
        <MobilePlayer
          libraryItemId={libraryItemId}
          title={title}
          author={author}
          duration={duration}
          pos={pos}
          isPlaying={isPlaying}
          chapters={rawChapters}
          speed={speed}
          setSpeed={setSpeed}
          genre={detail?.genre ?? ''}
          detail={detail}
          toggle={togglePlay}
          seek={seekTo}
          minimize={() => navigate(-1)}
          onToast={setToast}
        />
        {toast && (
          <div className="p-toast">
            <Icon name="check_circle" fill /> {toast}
          </div>
        )}
      </>
    )
  }

  const chSpan = cur.end - cur.start
  const chPos = Math.max(0, pos - cur.start)
  const chRatio = chSpan > 0 ? Math.min(1, chPos / chSpan) : 0
  const bookRatio = duration > 0 ? pos / duration : 0

  const clickRatio = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  }
  const seekClamp = (sec: number) => seekTo(Math.max(0, Math.min(duration, sec)))
  const prevCh = () =>
    seekClamp(chPos > 4 ? cur.start : chapters[Math.max(0, ci - 1)]?.start ?? 0)
  const nextCh = () =>
    seekClamp(chapters[Math.min(chapters.length - 1, ci + 1)]?.start ?? cur.start)

  // Car mode: a draggable big-touch player floating over the (brightened) hearth
  // background. Replaces the two-pane desktop layout when an in-car browser is
  // detected or the user forces it on.
  if (carMode) {
    return (
      <div className="player car-mode hearth-bg">
        <div
          className="player-hearth-bg car-bg"
          aria-hidden="true"
          style={{ backgroundImage: `url("${cozyHearth}")` }}
        />
        <CarPlayer
          libraryItemId={libraryItemId}
          title={title}
          author={author}
          chapters={chapters}
          ci={ci}
          cur={cur}
          pos={pos}
          duration={duration}
          isPlaying={isPlaying}
          rate={speed}
          setRate={setSpeed}
          togglePlay={togglePlay}
          seekClamp={seekClamp}
          prevCh={prevCh}
          nextCh={nextCh}
          onExit={() => setSetting('carMode', 'off')}
        />
        {toast && (
          <div className="p-toast">
            <Icon name="check_circle" fill /> {toast}
          </div>
        )}
      </div>
    )
  }

  const togglePanel = (p: Exclude<Panel, null>) => {
    setPop(null)
    setPanel((c) => (c === p ? null : p))
  }
  const togglePop = (p: Exclude<Pop, null>) => {
    setPanel(null)
    setPop((c) => (c === p ? null : p))
  }
  const open = panel !== null

  const addBookmark = () => {
    const label = formatTimestamp(pos)
    if (bookmarks.some((b) => Math.abs(b.time - pos) < 2)) {
      setToast('Already bookmarked here')
      return
    }
    addBookmarkApi(pos, cur.title)
    setToast(`Bookmark saved at ${label}`)
  }

  return (
    <div className={'player' + (open ? ' with-panel' : '') + (hearthBgPlayer ? ' hearth-bg' : '')}>
      {hearthBgPlayer && (
        <>
          <div
            className="player-hearth-bg"
            aria-hidden="true"
            style={{ backgroundImage: `url("${cozyHearth}")` }}
          />
          <div className="player-hearth-veil" aria-hidden="true" />
        </>
      )}
      <div className="player-col">
        <div className="p-head">
          <button
            className="p-minimize"
            onClick={() => navigate(-1)}
            aria-label="Minimize player"
            title="Minimize"
          >
            <Icon name="keyboard_arrow_down" />
          </button>
          <div className="p-head-title">
            <div className="eyebrow">HearthShelf</div>
            <h1
              style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}
            >
              Listening
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span
              className="pill sync-pill ok"
              title="Your progress is saved as you listen"
            >
              <Icon name="cloud_done" /> Synced
            </span>
            <button
              className={'pill' + (panel === 'queue' ? ' on' : '')}
              onClick={() => togglePanel('queue')}
            >
              <Icon name="reorder" /> Queue
            </button>
          </div>
        </div>

        <div className="p-cover-wrap">
          <Cover
            itemId={libraryItemId}
            title={title}
            author={author || undefined}
            fs={26}
            onClick={() => navigate(`/book/${libraryItemId}`)}
          />
          <div className="p-cover-prog">
            <i style={{ width: bookRatio * 100 + '%' }} />
          </div>
        </div>

        <div className="p-prog-row">
          <div className="p-pct">
            {Math.round(bookRatio * 100)}
            <small>%</small>
          </div>
          <div className="p-ch">
            Ch {ci + 1} / {chapters.length || 1}
          </div>
        </div>

        {/* secondary context line - the metric the main scrubber is NOT showing */}
        {scrubber === 'book' ? (
          <>
            <div
              className="prog-line seekable"
              onClick={(e) => seekClamp(cur.start + clickRatio(e) * chSpan)}
            >
              <i style={{ width: chRatio * 100 + '%' }} />
            </div>
            <div className="p-times">
              <span>{cur.title}</span>
              <span>-{formatTimestamp(chSpan - chPos)} in ch</span>
            </div>
          </>
        ) : (
          <>
            <div
              className="prog-line seekable"
              onClick={(e) => seekClamp(clickRatio(e) * duration)}
            >
              <i style={{ width: bookRatio * 100 + '%' }} />
            </div>
            <div className="p-times">
              <span>{formatTimestamp(pos)} elapsed</span>
              <span>{formatTimestamp(duration - pos)} left</span>
            </div>
          </>
        )}

        {/* primary scrubber */}
        <div style={{ width: '100%', marginTop: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
            {scrubber === 'book' ? 'Full book' : cur.title}
          </div>
          {scrubber === 'book' ? (
            <div
              className="scrub seekable"
              onClick={(e) => seekClamp(clickRatio(e) * duration)}
            >
              <i style={{ width: bookRatio * 100 + '%' }} />
              <b style={{ left: bookRatio * 100 + '%' }} />
            </div>
          ) : (
            <div
              className="scrub seekable"
              onClick={(e) => seekClamp(cur.start + clickRatio(e) * chSpan)}
            >
              <i style={{ width: chRatio * 100 + '%' }} />
              <b style={{ left: chRatio * 100 + '%' }} />
            </div>
          )}
          <div className="p-times">
            {scrubber === 'book' ? (
              <>
                <span>{formatTimestamp(pos)} elapsed</span>
                <span>{formatTimestamp(duration - pos)} left</span>
              </>
            ) : (
              <>
                <span>{formatTimestamp(chPos)}</span>
                <span>-{formatTimestamp(chSpan - chPos)}</span>
              </>
            )}
          </div>
        </div>

        <div className="p-transport">
          <button className="p-skip lite" title="Previous chapter" onClick={prevCh}>
            <Icon name="skip_previous" fill />
          </button>
          <button
            className="p-skip"
            title={`Back ${skipBack} seconds`}
            onClick={() => seekClamp(pos - skipBack)}
          >
            <Icon name="replay" />
            <small>{skipBack}</small>
          </button>
          <button className="p-play" onClick={togglePlay}>
            <Icon name={isPlaying ? 'pause' : 'play_arrow'} fill />
          </button>
          <button
            className="p-skip"
            title={`Forward ${skipFwd} seconds`}
            onClick={() => seekClamp(pos + skipFwd)}
          >
            <Icon name="replay" style={{ transform: 'scaleX(-1)' }} />
            <small>{skipFwd}</small>
          </button>
          <button className="p-skip lite" title="Next chapter" onClick={nextCh}>
            <Icon name="skip_next" fill />
          </button>
        </div>

        <div className="p-actions">
          {pop === 'speed' && (
            <div className="p-pop">
              <SpeedPopover speed={speed} setSpeed={setSpeed} onClose={() => setPop(null)} />
            </div>
          )}
          {pop === 'sleep' && (
            <div className="p-pop">
              <SleepPopover ctl={sleepCtl} onClose={() => setPop(null)} />
            </div>
          )}
          {pop === 'bookmark' && (
            <div className="p-pop">
              <div className="pop-head">
                <Icon name="bookmark" /> Bookmarks
                <span className="pop-x" onClick={() => setPop(null)}>
                  <Icon name="close" style={{ fontSize: 18 }} />
                </span>
              </div>
              <button
                className="btn-sm btn-green"
                style={{
                  width: '100%',
                  justifyContent: 'center',
                  marginBottom: bookmarks.length ? 12 : 0,
                }}
                onClick={addBookmark}
              >
                <Icon name="bookmark_add" /> Bookmark {formatTimestamp(pos)}
              </button>
              {bookmarks.length === 0 ? (
                <div className="pop-empty">No bookmarks yet</div>
              ) : (
                <div className="pop-scroll">
                  {bookmarks.map((b) => {
                    const label = formatTimestamp(b.time)
                    const jump = () => {
                      seekTo(b.time)
                      setToast(`Jumped to ${label}`)
                    }
                    return (
                      <div className="bm-row" key={b.time}>
                        <span className="bm-t" onClick={jump}>
                          {label}
                        </span>
                        <span className="bm-n" onClick={jump}>
                          {b.title}
                        </span>
                        <span
                          className="bm-x"
                          onClick={() => removeBookmark(b.time)}
                        >
                          <Icon name="delete" style={{ fontSize: 17 }} />
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {pop === 'recent' && (
            <div className="p-pop">
              <div className="pop-head">
                <Icon name="history" /> Recent listens
                <span className="pop-x" onClick={() => setPop(null)}>
                  <Icon name="close" style={{ fontSize: 18 }} />
                </span>
              </div>
              <div className="pop-scroll">
                <RecentListens
                  libraryItemId={libraryItemId}
                  onSeek={(sec) => {
                    seekClamp(sec)
                    setToast(`Jumped to ${formatTimestamp(sec)}`)
                    setPop(null)
                  }}
                />
              </div>
            </div>
          )}

          <div className="action-grid">
            <button
              className={'pill' + (panel === 'chapters' ? ' on' : '')}
              onClick={() => togglePanel('chapters')}
            >
              <Icon name="list" /> Chapters
            </button>
            <button
              className={'pill' + (panel === 'details' ? ' on' : '')}
              onClick={() => togglePanel('details')}
            >
              <Icon name="info" /> Book details
            </button>
            <button
              className={'pill' + (panel === 'reader' ? ' on' : '')}
              onClick={() => togglePanel('reader')}
            >
              <Icon name="menu_book" /> Read along
            </button>
            <button
              className={'pill' + (pop === 'speed' ? ' on' : '')}
              onClick={() => togglePop('speed')}
            >
              <Icon name="speed" /> {speed}×
            </button>
            <button
              className={'pill' + (pop === 'sleep' || sleepCtl.active ? ' on' : '')}
              onClick={() => togglePop('sleep')}
            >
              <Icon name="bedtime" />{' '}
              {sleepCtl.sleeping
                ? `Sleep · ${formatTimestamp(sleepCtl.left)}`
                : sleepCtl.active
                  ? `Sleep · ${sleepCtl.endsAt}`
                  : 'Sleep timer'}
            </button>
            <button
              className={'pill' + (pop === 'bookmark' ? ' on' : '')}
              onClick={() => togglePop('bookmark')}
            >
              <Icon name="bookmark_add" /> Bookmark
              {bookmarks.length > 0 && (
                <span className="badge-dot">{bookmarks.length}</span>
              )}
            </button>
            <button
              className={'pill' + (pop === 'recent' ? ' on' : '')}
              onClick={() => togglePop('recent')}
            >
              <Icon name="history" /> Recent listens
            </button>
          </div>
        </div>
      </div>

      <div className={'p-panel' + (open ? ' open' : '')} aria-hidden={!open}>
        {panel === 'chapters' && (
          <ChaptersPanel
            chapters={chapters}
            curIdx={ci}
            onSeek={(start) => seekTo(start)}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === 'reader' && (
          <div className="pp-inner pp-reader">
            <PanelHead icon="menu_book" title="Read along" onClose={() => setPanel(null)} />
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: 14,
                padding: '48px 24px',
                color: 'var(--text-muted)',
              }}
            >
              <Icon name="auto_stories" style={{ fontSize: 42, opacity: 0.5 }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                Read in browser
              </div>
              <div style={{ fontSize: 12.5, maxWidth: 280, lineHeight: 1.5 }}>
                Open this book in the in-browser reader. Jump to where the audio
                is from inside the reader.
              </div>
              <button
                className="btn btn-primary"
                onClick={() => navigate(`/reader/${libraryItemId}`)}
              >
                <Icon name="menu_book" fill /> Open reader
              </button>
            </div>
          </div>
        )}
        {panel === 'details' && (
          <div className="pp-inner">
            <PanelHead icon="info" title="Book details" onClose={() => setPanel(null)} />
            <div className="pp-scroll" style={{ padding: '0 4px' }}>
              <div style={{ display: 'flex', gap: 18, marginBottom: 18 }}>
                <Cover
                  itemId={libraryItemId}
                  title={title}
                  fs={9}
                  style={{ width: 116, height: 116, borderRadius: 12, flex: 'none' }}
                />
                <div style={{ minWidth: 0 }}>
                  <h2
                    style={{
                      fontSize: 19,
                      fontWeight: 700,
                      margin: '0 0 6px',
                      lineHeight: 1.15,
                    }}
                  >
                    {title}
                  </h2>
                  <div className="by">
                    by <b>{author}</b>
                  </div>
                  {detail?.narrator && (
                    <div className="by" style={{ marginTop: 2 }}>
                      Read by <b>{detail.narrator}</b>
                    </div>
                  )}
                </div>
              </div>
              <div className="meta-chips" style={{ margin: '0 0 18px' }}>
                <span className="chip">
                  <Icon name="schedule" /> {formatTimestamp(duration)}
                </span>
                <span className="chip">
                  <Icon name="list" /> {chapters.length} chapters
                </span>
                {detail?.publishedYear && (
                  <span className="chip">
                    <Icon name="calendar_today" /> {detail.publishedYear}
                  </span>
                )}
                {detail?.genre && (
                  <span className="chip">
                    <Icon name="category" /> {detail.genre}
                  </span>
                )}
              </div>
              {detail?.series && (
                <div
                  className="pp-series-row"
                  onClick={() => navigate(`/series/${detail.series!.id}`)}
                >
                  <Icon name="auto_stories" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="pp-series-name">{detail.series.name}</div>
                    {detail.series.sequence && (
                      <div className="pp-series-seq">
                        Book {detail.series.sequence}
                      </div>
                    )}
                  </div>
                  <Icon name="chevron_right" />
                </div>
              )}
              {detail?.description && (
                <p
                  className="desc"
                  style={{ margin: '0 0 18px', whiteSpace: 'pre-line' }}
                >
                  {stripHtml(detail.description)}
                </p>
              )}
              <button
                className="btn-sm btn-ghost"
                onClick={() => navigate(`/book/${libraryItemId}`)}
              >
                <Icon name="open_in_new" /> Open full details
              </button>
            </div>
          </div>
        )}
        {panel === 'queue' && (
          <QueuePanel
            nowId={libraryItemId}
            nowTitle={title}
            nowAuthor={author}
            onClose={() => setPanel(null)}
            onPlay={(id) => ui.playItem(id)}
          />
        )}
      </div>

      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
    </div>
  )
}
