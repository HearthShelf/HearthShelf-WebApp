import { Cover } from '@/components/shared/Cover'
import { Icon } from '@/components/common/Icon'
import { stripHtml } from '@hearthshelf/core'

// Duration label for an episode (seconds -> "1h 12m" / "34m").
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export interface EpisodeCardData {
  id: string
  title: string
  description: string | null
  publishedAt: number | null
  durationSec: number | null
  hasAudioFile: boolean
  /** Parent show's library item id (cover + play come from here). */
  podcastItemId: string
  /** Parent show's display title (the byline on the row). */
  podTitle: string
  /** 0..1, resolved from /api/me by the parent item's progress. */
  played?: number
}

interface EpisodeCardProps {
  ep: EpisodeCardData
  onPlay: (ep: EpisodeCardData) => void
  onToast?: (msg: string) => void
}

// Shared episode row used by the podcast detail + latest pages. Play/Resume/Play
// again follows the played fraction. Queue / Mark finished are deferred and toast
// rather than no-op, matching the self-hosted surface.
export function EpisodeCard({ ep, onPlay, onToast }: EpisodeCardProps) {
  const played = ep.played ?? 0
  const finished = played >= 1
  const inProgress = played > 0 && played < 1
  const downloaded = ep.hasAudioFile

  const date = ep.publishedAt
    ? new Date(ep.publishedAt).toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : ''
  const mins = ep.durationSec ? Math.round(ep.durationSec / 60) : 0

  const metaTail = finished
    ? ' · Finished'
    : inProgress
      ? ` · ${Math.round(played * 100)}%`
      : ''

  return (
    <div className="ep-card">
      <Cover
        itemId={ep.podcastItemId}
        title={ep.podTitle}
        kicker="Podcast"
        fs={5}
        className="ep-cover"
      />
      <div className="ep-body">
        <div className="ep-pod">{ep.podTitle}</div>
        <div className="ep-meta">
          {date}
          {mins > 0 && ` · ${formatDuration(ep.durationSec ?? 0)}`}
          {metaTail}
        </div>
        <div className="ep-title">{ep.title}</div>
        {ep.description && (
          <div className="ep-desc">{stripHtml(ep.description)}</div>
        )}
        <div className="ep-actions">
          <button className="btn-sm btn-accent" onClick={() => onPlay(ep)}>
            <Icon name={finished ? 'replay' : 'play_arrow'} fill />{' '}
            {inProgress ? 'Resume' : finished ? 'Play again' : 'Play'}
          </button>
          <button
            className="btn-sm btn-ghost"
            onClick={() => onToast?.('Queue is coming soon')}
          >
            <Icon name="playlist_add" /> Queue
          </button>
          <button
            className="btn-sm btn-ghost"
            onClick={() => onToast?.('Mark finished is coming soon')}
          >
            <Icon name="task_alt" /> {finished ? 'Finished' : 'Mark finished'}
          </button>
          {downloaded && (
            <span className="chip">
              <Icon name="download_done" /> Downloaded
            </span>
          )}
        </div>
        {inProgress && (
          <div className="ep-prog">
            <i style={{ width: played * 100 + '%' }} />
          </div>
        )}
      </div>
    </div>
  )
}
