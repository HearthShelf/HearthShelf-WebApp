import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getPodcast, type AbsPodcast } from '@/api/absPodcasts'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useMediaProgress } from '@/hooks/useMediaProgress'
import { usePlayEpisode } from '@/player/usePlayEpisode'
import { useToast } from '@/hooks/useToast'
import { stripHtml } from '@hearthshelf/core'
import { Cover, tintFor } from '@/components/shared/Cover'
import { Icon } from '@/components/common/Icon'
import { EpisodeCard, type EpisodeCardData } from '@/components/podcast/EpisodeCard'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorState } from '@/components/common/ErrorState'

function PodcastDetail({ podcast }: { podcast: AbsPodcast }) {
  const playEpisode = usePlayEpisode()
  const progressById = useMediaProgress()
  const { toast, show } = useToast()

  const title = podcast.title
  const cv = tintFor(title)
  const episodes = podcast.episodes
  const category = podcast.genre || 'Podcast'
  // ABS tracks episode progress under the parent podcast item.
  const played = progressById.get(podcast.id)?.progress ?? 0

  const play = (ep: EpisodeCardData) =>
    void playEpisode({
      itemId: podcast.id,
      episodeId: ep.id,
      episodeTitle: ep.title,
      podcastTitle: title,
    })

  const toCard = (ep: AbsPodcast['episodes'][number]): EpisodeCardData => ({
    ...ep,
    podcastItemId: podcast.id,
    podTitle: title,
    played,
  })

  return (
    <div className="page fade-in" style={{ ['--glow-accent' as string]: cv }}>
      <div className="crumb">
        <Link className="lnk" to="/library">
          Podcasts
        </Link>
        <Icon name="chevron_right" />
        {title}
      </div>

      <div className="detail-top">
        <div className="detail-cover" data-cv={cv}>
          <Cover itemId={podcast.id} title={title} kicker="Podcast" fs={18} />
        </div>
        <div className="detail-main">
          <h1>{title}</h1>
          <div className="d-sub" style={{ marginTop: 8 }}>
            By {podcast.author || 'Unknown'} · {category}
          </div>
          {podcast.description && (
            <p className="detail-desc" style={{ marginTop: 16 }}>
              {stripHtml(podcast.description)}
            </p>
          )}
          <div className="detail-actions">
            {episodes[0] && (
              <button
                className="btn btn-primary"
                onClick={() =>
                  void playEpisode({
                    itemId: podcast.id,
                    episodeId: episodes[0].id,
                    episodeTitle: episodes[0].title,
                    podcastTitle: title,
                  })
                }
              >
                <Icon name="play_arrow" fill /> Play latest
              </button>
            )}
            <button className="pill" onClick={() => show('Auto-download is coming soon')}>
              <Icon name="notifications_active" /> Auto-download
            </button>
            {podcast.feedUrl && (
              <a
                className="pill"
                href={podcast.feedUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="rss_feed" /> RSS feed
              </a>
            )}
            <button className="pill" onClick={() => show('Editing is coming soon')}>
              <Icon name="edit" /> Edit
            </button>
          </div>
        </div>
      </div>

      <div className="detail-section">
        <div className="section-head">
          <Icon name="podcasts" />
          <h2>Episodes · {episodes.length}</h2>
        </div>
        <div className="ep-list" style={{ maxWidth: 'none' }}>
          {episodes.map((ep) => (
            <EpisodeCard key={ep.id} ep={toCard(ep)} onPlay={play} onToast={show} />
          ))}
        </div>
      </div>

      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
    </div>
  )
}

export function PodcastDetailPage() {
  const { podcastId } = useParams()
  const { target } = useActiveServer()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['podcast', target?.serverId, podcastId],
    queryFn: () => getPodcast(target!, podcastId as string),
    enabled: Boolean(target) && Boolean(podcastId),
    staleTime: 10 * 60 * 1000,
  })

  if (!target) return null
  if (isLoading) {
    return (
      <div className="page">
        <LoadingSpinner className="py-12" label="Loading podcast..." />
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="page">
        <ErrorState message="Could not load this podcast." onRetry={refetch} />
      </div>
    )
  }
  return <PodcastDetail podcast={data} />
}
