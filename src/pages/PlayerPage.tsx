import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayer } from '@/player/PlayerProvider'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { Icon } from '@/components/common/Icon'

const SPEEDS = [0.8, 1, 1.2, 1.5, 1.75, 2, 2.5, 3]
const SLEEP_OPTIONS = [15, 30, 45, 60]

function formatTimestamp(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

type Pop = 'speed' | 'sleep' | 'chapters' | null

/**
 * Full-screen, immersive now-playing view. The shell hides the AppBar on
 * /player. Drives the single global player from usePlayerProvider: cover,
 * title/author, transport, scrubber, speed, sleep timer, and chapter list.
 */
export function PlayerPage() {
  const navigate = useNavigate()
  const ui = useMediaUI()
  const {
    now,
    playing,
    positionSec,
    togglePlay,
    seekTo,
    skip,
    rate,
    setRate,
    setSleepMinutes,
    sleepArmed,
    sleepRemainingMs,
  } = usePlayer()

  const [pop, setPop] = useState<Pop>(null)

  const chapters = now?.chapters ?? []
  const duration = now?.totalDurationSec ?? 0

  // Index of the chapter currently playing (0 when there are no chapters).
  const ci = useMemo(() => {
    if (chapters.length === 0) return 0
    const idx = chapters.findIndex((c) => positionSec < c.endSec)
    return idx === -1 ? chapters.length - 1 : idx
  }, [chapters, positionSec])

  // Keyboard shortcuts (player route only).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowLeft') {
        skip(-15)
      } else if (e.key === 'ArrowRight') {
        skip(15)
      } else if (e.key === 'Escape') {
        setPop(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [togglePlay, skip])

  if (!now) {
    return (
      <div className="page fade-in" style={{ display: 'grid', placeItems: 'center', minHeight: '70vh' }}>
        <div className="cozy-empty" style={{ position: 'relative' }}>
          <div className="eyebrow">By the hearth</div>
          <h1 className="cozy-h">Nothing playing</h1>
          <p className="cozy-sub">
            The fire's lit and the chair's yours. Pull something off the shelf and settle in.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/library')}>
            <Icon name="auto_stories" fill /> Browse the library
          </button>
        </div>
      </div>
    )
  }

  const bookRatio = duration > 0 ? positionSec / duration : 0
  const cover = ui.coverUrl(now.itemId, 480)

  const clickRatio = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  }
  const sleepMins = sleepRemainingMs != null ? Math.ceil(sleepRemainingMs / 60_000) : null

  const togglePop = (p: Exclude<Pop, null>) => setPop((c) => (c === p ? null : p))

  return (
    <div className="player">
      <div className="player-col">
        <div className="p-head">
          <button
            className="icon-btn"
            onClick={() => navigate(-1)}
            aria-label="Minimize player"
            title="Minimize"
          >
            <Icon name="keyboard_arrow_down" />
          </button>
          <div className="p-head-title">
            <div className="eyebrow">HearthShelf</div>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
              Listening
            </h1>
          </div>
          <div style={{ width: 40 }} />
        </div>

        <div className="p-cover-wrap">
          <div
            className="cover"
            style={{
              width: 320,
              height: 320,
              borderRadius: 'var(--r-card)',
              boxShadow: 'var(--shadow-lift)',
              overflow: 'hidden',
              cursor: 'pointer',
            }}
            onClick={() => navigate(`/book/${now.itemId}`)}
          >
            {cover ? (
              <img
                src={cover}
                alt={now.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <span style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', color: 'var(--text-muted)' }}>
                <Icon name="menu_book" />
              </span>
            )}
          </div>
          <div className="p-cover-prog">
            <i style={{ width: bookRatio * 100 + '%' }} />
          </div>
        </div>

        <div className="p-head-title" style={{ textAlign: 'center', marginTop: 18 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
            {now.title}
          </h2>
          {now.author && (
            <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>{now.author}</div>
          )}
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

        {/* Primary scrubber (whole book). */}
        <div
          className="scrub seekable"
          onClick={(e) => seekTo(clickRatio(e) * duration)}
          style={{ cursor: 'pointer' }}
        >
          <i style={{ width: bookRatio * 100 + '%' }} />
          <b style={{ left: bookRatio * 100 + '%' }} />
        </div>
        <div className="p-times">
          <span>{formatTimestamp(positionSec)} elapsed</span>
          <span>{formatTimestamp(Math.max(0, duration - positionSec))} left</span>
        </div>

        <div className="p-transport">
          <button className="p-skip" title="Back 15 seconds" onClick={() => skip(-15)}>
            <Icon name="replay" />
            <small>15</small>
          </button>
          <button className="p-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
            <Icon name={playing ? 'pause' : 'play_arrow'} fill />
          </button>
          <button className="p-skip" title="Forward 15 seconds" onClick={() => skip(15)}>
            <Icon name="replay" style={{ transform: 'scaleX(-1)' }} />
            <small>15</small>
          </button>
        </div>

        <div className="p-actions">
          {pop === 'speed' && (
            <div className="p-pop">
              <div className="pop-head">
                <Icon name="speed" /> Playback speed
                <span className="pop-x" onClick={() => setPop(null)}>
                  <Icon name="close" style={{ fontSize: 18 }} />
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    className={'pill' + (rate === s ? ' on' : '')}
                    style={{ justifyContent: 'center' }}
                    onClick={() => {
                      setRate(s)
                      setPop(null)
                    }}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>
          )}
          {pop === 'sleep' && (
            <div className="p-pop">
              <div className="pop-head">
                <Icon name="bedtime" /> Sleep timer
                <span className="pop-x" onClick={() => setPop(null)}>
                  <Icon name="close" style={{ fontSize: 18 }} />
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {SLEEP_OPTIONS.map((m) => (
                  <button
                    key={m}
                    className="pill"
                    style={{ justifyContent: 'center' }}
                    onClick={() => {
                      setSleepMinutes(m)
                      setPop(null)
                    }}
                  >
                    {m} min
                  </button>
                ))}
              </div>
              {sleepArmed && (
                <button
                  className="btn-sm btn-ghost danger"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                  onClick={() => {
                    setSleepMinutes(null)
                    setPop(null)
                  }}
                >
                  Cancel timer
                </button>
              )}
            </div>
          )}
          {pop === 'chapters' && chapters.length > 0 && (
            <div className="p-pop">
              <div className="pop-head">
                <Icon name="list" /> Chapters
                <span className="pop-x" onClick={() => setPop(null)}>
                  <Icon name="close" style={{ fontSize: 18 }} />
                </span>
              </div>
              <div className="chap-list pp-scroll" style={{ maxHeight: 320 }}>
                {chapters.map((c, i) => {
                  const isNow = i === ci
                  const done = i < ci
                  return (
                    <div
                      className={'chap' + (isNow ? ' now' : '') + (done ? ' done' : '')}
                      key={c.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        seekTo(c.startSec)
                        setPop(null)
                      }}
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
                      <span className="cd">{formatTimestamp(c.endSec - c.startSec)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="action-grid">
            <button
              className={'pill' + (pop === 'chapters' ? ' on' : '')}
              onClick={() => togglePop('chapters')}
              disabled={chapters.length === 0}
            >
              <Icon name="list" /> Chapters
            </button>
            <button
              className={'pill' + (pop === 'speed' ? ' on' : '')}
              onClick={() => togglePop('speed')}
            >
              <Icon name="speed" /> {rate}×
            </button>
            <button
              className={'pill' + (pop === 'sleep' || sleepArmed ? ' on' : '')}
              onClick={() => togglePop('sleep')}
            >
              <Icon name="bedtime" />{' '}
              {sleepArmed && sleepMins != null ? `Sleep · ${sleepMins}m` : 'Sleep timer'}
            </button>
            <button className="pill" onClick={() => navigate(`/book/${now.itemId}`)}>
              <Icon name="info" /> Book details
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
