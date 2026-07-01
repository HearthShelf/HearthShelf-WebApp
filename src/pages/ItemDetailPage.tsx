import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getItemDetail, getMe } from '@/api/absLibrary'
import { getBookDetailFull, itemFileDownloadUrl, itemCoverFullUrl } from '@/api/absBookDetail'
import { useMediaProgress } from '@/hooks/useMediaProgress'
import { useMarkFinished } from '@/hooks/useMarkFinished'
import { useBookmarks } from '@/hooks/useBookmarks'
import { useToast } from '@/hooks/useToast'
import { usePlayer } from '@/player/PlayerProvider'
import { useMediaUI } from '@/components/shared/MediaUIContext'
import { formatTimestamp, stripHtml } from '@hearthshelf/core'
import { externalLinks } from '@/lib/externalLinks'
import { Cover, tintFor } from '@/components/shared/Cover'
import { ImageZoomViewer } from '@/components/common/ImageZoomViewer'
import { Icon } from '@/components/common/Icon'
import { Stars } from '@/components/common/Stars'
import { Dropdown, MItem } from '@/components/common/Dropdown'
import { ItemEditModal } from '@/components/library/ItemEditModal'
import { ChapterEditorModal, type EditableChapter } from '@/components/library/ChapterEditorModal'
import { Modal } from '@/components/common/Modal'
import { RecentListens } from '@/components/player/RecentListens'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'

type DetailTab = 'chapters' | 'tracks' | 'ebook' | 'files'

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb.toFixed(1)} MB`
}

/**
 * Full book detail + player. Loads the expanded item two ways: the lean shape
 * the global player needs (tracks/chapters/progress, via getItemDetail) and the
 * richer detail fields the page renders (rating, isbn/asin, per-file metadata,
 * ebook, tags, via getBookDetailFull). Renders inside <ActiveServerMediaUI>, so
 * the active server is connected; we read the target from useActiveServer (non-
 * null by the time this renders) and guard defensively.
 */
export function ItemDetailPage() {
  const { itemId } = useParams()
  const { target } = useActiveServer()
  const navigate = useNavigate()
  const player = usePlayer()
  const ui = useMediaUI()
  const progressById = useMediaProgress()
  const { markFinished, isPending: marking } = useMarkFinished()
  const { toast, show } = useToast()

  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState<DetailTab>('chapters')
  const [editing, setEditing] = useState(false)
  const [editingChapters, setEditingChapters] = useState(false)
  const [zoomCover, setZoomCover] = useState(false)
  const [showSessions, setShowSessions] = useState(false)
  const [showBookmarks, setShowBookmarks] = useState(false)
  const { bookmarks, removeBookmark } = useBookmarks(itemId ?? null)

  // Lean shape for the global player (tracks/chapters/progress).
  const { data: playable } = useQuery({
    queryKey: ['abs-item', target?.serverId, itemId],
    queryFn: () => getItemDetail(target!, itemId as string),
    enabled: Boolean(target && itemId),
  })

  // Rich detail shape the page renders.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['abs-book-detail', target?.serverId, itemId],
    queryFn: () => getBookDetailFull(target!, itemId as string),
    enabled: Boolean(target && itemId),
    staleTime: 10 * 60 * 1000,
  })

  // Admin gating for Edit / Download (update / download permission).
  const { data: me } = useQuery({
    queryKey: ['abs-me', target?.serverId],
    queryFn: () => getMe(target!),
    enabled: Boolean(target),
    staleTime: 10 * 60 * 1000,
  })
  const canEdit = me?.type === 'admin' || me?.type === 'root' || me?.permissions?.update === true
  const canDownload = me?.permissions?.download !== false

  // Load this book into the GLOBAL player when it opens (paused at the saved
  // position), unless it's already the now-playing book - so navigating back to
  // a playing book doesn't restart it.
  const alreadyPlaying = player.now?.itemId === itemId && player.now?.serverId === target?.serverId
  useEffect(() => {
    if (!playable || !target || alreadyPlaying) return
    player.play({
      serverId: target.serverId,
      serverUrl: target.serverUrl,
      itemId: playable.id,
      title: playable.title,
      author: playable.author,
      narrator: playable.narrator,
      coverUrl: playable.coverUrl,
      tracks: playable.tracks,
      chapters: playable.chapters,
      totalDurationSec: playable.durationSec,
      startAtSec: playable.progress?.currentTimeSec ?? 0,
      playSessionId: playable.playSessionId,
    })
    // Only re-run when the loaded book changes, not on every player tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playable, target?.serverId, target?.serverUrl])

  if (!target) {
    return (
      <div className="page">
        <ErrorState message="No active server." />
      </div>
    )
  }
  if (isLoading) {
    return (
      <div className="page">
        <LoadingSpinner className="py-12" label="Loading book..." />
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="page">
        <ErrorState message="Could not load this book." onRetry={() => void refetch()} />
      </div>
    )
  }

  const title = data.title
  const cv = tintFor(title)
  const author = data.author
  const authorId = data.authorId
  const narrator = data.narrator
  const series = data.series
  const chapters: EditableChapter[] = (playable?.chapters ?? []).map((c) => ({
    title: c.title,
    start: c.startSec,
    end: c.endSec,
  }))
  const tracks = data.audioFiles
  const duration = data.durationSec
  const rating = data.rating
  const hasEbook = !!data.ebookFile || !!data.ebookFormat
  const ebookOnly = hasEbook && tracks.length === 0

  const progress = progressById.get(data.id)
  const pct = progress?.progress ?? 0
  const finished = progress?.isFinished ?? false
  const chaptersLeft = Math.round(chapters.length * (1 - pct))

  const playLabel = finished ? 'Listen again' : pct > 0 ? 'Resume' : 'Start listening'

  const description = data.description ? stripHtml(data.description) : ''
  const links = externalLinks({ title, author, isbn: data.isbn, asin: data.asin })
  const coverFull = itemCoverFullUrl(target, data.id)

  const playChapter = (start: number) => {
    if (player.now?.itemId === data.id && player.now?.serverId === target.serverId) {
      player.seekTo(start)
    } else if (playable) {
      player.play({
        serverId: target.serverId,
        serverUrl: target.serverUrl,
        itemId: playable.id,
        title: playable.title,
        author: playable.author,
        narrator: playable.narrator,
        coverUrl: playable.coverUrl,
        tracks: playable.tracks,
        chapters: playable.chapters,
        totalDurationSec: playable.durationSec,
        startAtSec: start,
        autoplay: true,
        playSessionId: playable.playSessionId,
      })
    }
  }

  return (
    <div className="page fade-in" style={{ ['--glow-accent' as string]: cv }}>
      <div className="crumb">
        <Link className="lnk" to="/library">
          Library
        </Link>
        <Icon name="chevron_right" />
        {title}
      </div>

      <div className="detail-top">
        <div className="detail-cover" data-cv={cv}>
          <Cover
            itemId={data.id}
            title={title}
            author={author}
            fs={18}
            width={480}
            className="dc-zoomable"
            onClick={() => setZoomCover(true)}
            overlay={
              <span className="dc-zoom-hint" aria-hidden>
                <Icon name="zoom_in" />
              </span>
            }
          />
          {pct > 0 && !finished && (
            <>
              <div className="prog-line">
                <i style={{ width: pct * 100 + '%' }} />
              </div>
              <div className="dc-prog-cap">
                {Math.round(pct * 100)}% · {chaptersLeft} chapters left
              </div>
            </>
          )}
          {finished && (
            <div className="dc-prog-cap" style={{ color: '#a7c896' }}>
              <Icon name="check_circle" fill style={{ fontSize: 14, verticalAlign: '-2px' }} />{' '}
              Finished
            </div>
          )}
        </div>

        <div className="detail-main">
          <h1>
            {title}
            {rating != null && rating >= 4.7 && (
              <span className="badges">
                <span className="badge-pill abridged">Top rated</span>
              </span>
            )}
          </h1>
          {data.subtitle && <div className="d-sub">{data.subtitle}</div>}
          {series && (
            <div className="detail-series-links">
              <span className="d-series-chip" onClick={() => navigate(`/series/${series.id}`)}>
                {series.name}
                {series.sequence && ` #${series.sequence}`}
              </span>
            </div>
          )}
          <div className="d-sub" style={{ marginTop: 8 }}>
            By{' '}
            {authorId ? (
              <span
                className="d-author-link"
                style={{ color: 'var(--text)', fontWeight: 600, cursor: 'pointer' }}
                onClick={() => navigate(`/author/${authorId}`)}
              >
                {author}
              </span>
            ) : (
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{author}</span>
            )}
          </div>

          <dl className="meta-rows">
            {narrator && (
              <>
                <dt>Narrator</dt>
                <dd>
                  <Link className="lnk" to={`/library?narrator=${encodeURIComponent(narrator)}`}>
                    {narrator}
                  </Link>
                </dd>
              </>
            )}
            {data.publishedYear && (
              <>
                <dt>Published</dt>
                <dd>{data.publishedYear}</dd>
              </>
            )}
            {data.genres[0] && (
              <>
                <dt>Genre</dt>
                <dd>
                  <Link className="lnk" to={`/library?genre=${encodeURIComponent(data.genres[0])}`}>
                    {data.genres[0]}
                  </Link>
                </dd>
              </>
            )}
            {rating != null && rating > 0 && (
              <>
                <dt>Rating</dt>
                <dd style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Stars rating={rating} />
                  <span className="mono" style={{ fontFamily: 'var(--font-mono)' }}>
                    {rating.toFixed(1)}
                  </span>
                </dd>
              </>
            )}
            <dt>Duration</dt>
            <dd className="mono" style={{ fontFamily: 'var(--font-mono)' }}>
              {formatDuration(duration)} · {chapters.length} chapters
            </dd>
          </dl>

          <div className="detail-actions">
            {ebookOnly ? (
              <button className="btn btn-primary" onClick={() => navigate(`/reader/${data.id}`)}>
                <Icon name="menu_book" fill /> Read
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => void ui.playItem(data.id, { openPlayer: true })}
              >
                <Icon name="play_arrow" fill /> {playLabel}
              </button>
            )}
            {hasEbook && !ebookOnly && (
              <button className="pill" onClick={() => navigate(`/reader/${data.id}`)}>
                <Icon name="menu_book" /> Read
              </button>
            )}
            <button
              className={'pill' + (finished ? ' on' : '')}
              disabled={marking}
              onClick={() => void markFinished([data.id], !finished)}
            >
              <Icon name={finished ? 'task_alt' : 'check'} fill={finished} />{' '}
              {finished ? 'Finished' : 'Mark finished'}
            </button>
            {(pct > 0 || finished) && (
              <button className="pill" onClick={() => setShowSessions(true)}>
                <Icon name="history" /> Previous sessions
              </button>
            )}
            {canEdit && (
              <button className="pill" onClick={() => setEditing(true)}>
                <Icon name="edit" /> Edit
              </button>
            )}
            <Dropdown icon="more_horiz" label="">
              {canDownload && (
                <MItem
                  icon="download"
                  label="Download"
                  onClick={() => {
                    const ino = tracks[0]?.ino
                    const url = ino ? itemFileDownloadUrl(target, data.id, ino) : null
                    if (url) window.open(url, '_blank')
                  }}
                />
              )}
              <MItem
                icon="bookmark"
                label={bookmarks.length ? `Bookmarks (${bookmarks.length})` : 'Bookmarks'}
                onClick={() => setShowBookmarks(true)}
              />
            </Dropdown>
          </div>

          <div className="detail-ext">
            {links.map((l) => (
              <a
                key={l.key}
                className="ext-link"
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open on ${l.label}`}
              >
                <Icon name={l.icon} /> {l.label}
                <Icon name="open_in_new" style={{ fontSize: 15, opacity: 0.6 }} />
              </a>
            ))}
          </div>

          {description && (
            <>
              <div className={'detail-desc' + (expanded ? '' : ' clamp')}>{description}</div>
              <button className="read-more" onClick={() => setExpanded((e) => !e)}>
                {expanded ? 'Read less' : 'Read more'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="detail-section">
        <div className="toolbar2" style={{ marginBottom: 0 }}>
          {(
            [
              ['chapters', 'Chapters', chapters.length],
              ['tracks', 'Audio tracks', tracks.length],
              ...(hasEbook ? [['ebook', 'eBook', 1] as [DetailTab, string, number]] : []),
              ['files', 'Files', tracks.length + 1],
            ] as [DetailTab, string, number][]
          ).map(([id, lbl, n]) => (
            <button
              key={id}
              className={'pill' + (tab === id ? ' on' : '')}
              onClick={() => setTab(id)}
            >
              {lbl} <span style={{ opacity: 0.6 }}>{n}</span>
            </button>
          ))}
          {tab === 'chapters' && chapters.length > 0 && canEdit && (
            <>
              <div className="tb-spacer" />
              <button className="pill" onClick={() => setEditingChapters(true)}>
                <Icon name="edit" /> Edit chapters
              </button>
            </>
          )}
        </div>

        <div className="tbl-wrap" style={{ marginTop: 16 }}>
          {tab === 'chapters' && (
            <>
              <div className="dt-row chap dt-head">
                <span>#</span>
                <span>Title</span>
                <span>Start</span>
                <span>Length</span>
              </div>
              {chapters.map((c, i) => (
                <div className="dt-row chap" key={i} onClick={() => playChapter(c.start)}>
                  <span className="num">{i + 1}</span>
                  <span>{c.title}</span>
                  <span className="mono">{formatTimestamp(c.start)}</span>
                  <span className="mono">{formatTimestamp(c.end - c.start)}</span>
                </div>
              ))}
            </>
          )}

          {tab === 'tracks' && (
            <>
              <div className="dt-row track dt-head">
                <span>#</span>
                <span>File</span>
                <span>Codec</span>
                <span>Bitrate</span>
                <span>Size</span>
              </div>
              {tracks.map((t) => (
                <div className="dt-row track" key={t.ino}>
                  <span className="num">{t.index}</span>
                  <span>{t.filename}</span>
                  <span className="num">{(t.codec ?? '').toUpperCase()}</span>
                  <span className="num">
                    {t.bitRate ? `${Math.round(t.bitRate / 1000)} kbps` : '—'}
                  </span>
                  <span className="num">{formatBytes(t.size)}</span>
                </div>
              ))}
            </>
          )}

          {tab === 'ebook' && (
            <>
              <div className="dt-row file dt-head">
                <span />
                <span>File</span>
                <span>Format</span>
                <span>Size</span>
                <span />
              </div>
              <div
                className="dt-row file"
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/reader/${data.id}`)}
                title="Open in reader"
              >
                <Icon name="menu_book" style={{ fontSize: 18, color: 'var(--accent)' }} fill />
                <span>{data.ebookFile?.filename ?? 'ebook'}</span>
                <span className="num">
                  {(data.ebookFile?.format ?? data.ebookFormat ?? '').toUpperCase()}
                </span>
                <span className="num">
                  {data.ebookFile?.size ? formatBytes(data.ebookFile.size) : '—'}
                </span>
                <span className="mono" style={{ color: 'var(--accent)' }}>
                  <Icon name="chevron_right" />
                </span>
              </div>
            </>
          )}

          {tab === 'files' && (
            <>
              <div className="dt-row file dt-head">
                <span />
                <span>File</span>
                <span>Type</span>
                <span>Size</span>
                <span />
              </div>
              <div className="dt-row file">
                <Icon name="image" style={{ fontSize: 18, color: 'var(--text-muted)' }} />
                <span>cover.jpg</span>
                <span className="num">Image</span>
                <span className="num">—</span>
                <span />
              </div>
              {tracks.map((t) => {
                const dl = itemFileDownloadUrl(target, data.id, t.ino)
                return (
                  <div className="dt-row file" key={t.ino}>
                    <Icon name="audio_file" style={{ fontSize: 18, color: 'var(--text-muted)' }} />
                    <span>{t.filename}</span>
                    <span className="num">Audio</span>
                    <span className="num">{formatBytes(t.size)}</span>
                    {dl ? (
                      <a className="tbl-icon" title="Download" href={dl}>
                        <Icon name="download" />
                      </a>
                    ) : (
                      <span />
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>

      {zoomCover && coverFull && (
        <ImageZoomViewer src={coverFull} alt={title} onClose={() => setZoomCover(false)} />
      )}
      {editing && (
        <ItemEditModal
          target={target}
          item={data}
          chapters={chapters}
          onClose={() => setEditing(false)}
        />
      )}
      {showSessions && (
        <Modal title="Previous sessions" onClose={() => setShowSessions(false)}>
          <RecentListens
            libraryItemId={data.id}
            onSeek={(sec) => {
              playChapter(sec)
              show(`Jumped to ${formatTimestamp(sec)}`)
              setShowSessions(false)
            }}
          />
        </Modal>
      )}
      {showBookmarks && (
        <Modal title="Bookmarks" onClose={() => setShowBookmarks(false)}>
          {bookmarks.length === 0 ? (
            <div className="pop-empty">No bookmarks yet</div>
          ) : (
            <div className="bm-list">
              {bookmarks.map((b) => {
                const label = formatTimestamp(b.time)
                const jump = () => {
                  playChapter(b.time)
                  show(`Jumped to ${label}`)
                  setShowBookmarks(false)
                }
                return (
                  <div className="bm-row" key={b.time}>
                    <span className="bm-t" onClick={jump}>
                      {label}
                    </span>
                    <span className="bm-n" onClick={jump}>
                      {b.title}
                    </span>
                    <span className="bm-x" onClick={() => removeBookmark(b.time)}>
                      <Icon name="delete" style={{ fontSize: 17 }} />
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </Modal>
      )}
      {editingChapters && (
        <ChapterEditorModal
          target={target}
          itemId={data.id}
          chapters={chapters}
          duration={duration}
          onClose={() => setEditingChapters(false)}
        />
      )}
      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
    </div>
  )
}
