import { useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Loader2, AlertCircle, Play } from 'lucide-react'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getItemDetail } from '@/api/absLibrary'
import { AudioPlayer } from '@/components/AudioPlayer'
import { BookHeader } from '@/components/shared/BookHeader'
import { usePlayer } from '@/player/PlayerProvider'

/**
 * Item detail + player. Loads the expanded item (tracks + saved progress) and
 * mounts the audio player. Renders inside <ActiveServerMediaUI>, so the active
 * server is already connected and the MediaUI provider is mounted - we read the
 * target from useActiveServer() (non-null by the time this renders) and only
 * guard defensively against a null target.
 */
export function ItemDetailPage() {
  const { itemId } = useParams()
  const { target } = useActiveServer()
  const player = usePlayer()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['abs-item', target?.serverId, itemId],
    queryFn: () => getItemDetail(target!, itemId as string),
    enabled: Boolean(target && itemId),
  })

  // Load this book into the GLOBAL player when it opens (paused at the saved
  // position), unless it's already the now-playing book - so navigating back to
  // a playing book doesn't restart it. The global player keeps playing as the
  // user moves around; the docked mini-player reflects it.
  const alreadyPlaying =
    player.now?.itemId === itemId && player.now?.serverId === target?.serverId
  useEffect(() => {
    if (!data || !target || alreadyPlaying) return
    player.play({
      serverId: target.serverId,
      serverUrl: target.serverUrl,
      itemId: data.id,
      title: data.title,
      author: data.author,
      coverUrl: data.coverUrl,
      tracks: data.tracks,
      chapters: data.chapters,
      totalDurationSec: data.durationSec,
      startAtSec: data.progress?.currentTimeSec ?? 0,
    })
    // Only re-run when the loaded book changes, not on every player tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, target?.serverId, target?.serverUrl])

  // Lock-screen / media-key metadata.
  useEffect(() => {
    if (!data || !('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: data.title,
      artist: data.author,
      album: data.narrator ? `Narrated by ${data.narrator}` : undefined,
      artwork: data.coverUrl ? [{ src: data.coverUrl, sizes: '480x480' }] : undefined,
    })
    return () => {
      navigator.mediaSession.metadata = null
    }
  }, [data])

  const startListening = () => {
    if (!data || !target) return
    player.play({
      serverId: target.serverId,
      serverUrl: target.serverUrl,
      itemId: data.id,
      title: data.title,
      author: data.author,
      coverUrl: data.coverUrl,
      tracks: data.tracks,
      chapters: data.chapters,
      totalDurationSec: data.durationSec,
      startAtSec: data.progress?.currentTimeSec ?? 0,
      autoplay: true,
    })
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/library"
        className="t-muted mb-6 inline-flex items-center gap-1.5 text-[13px] hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Back to library
      </Link>

      {!target && (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="t-body text-card-foreground">No active server.</p>
          <Link to="/library" className="t-muted mt-2 inline-block text-[13px] underline">
            Go to the library
          </Link>
        </div>
      )}

      {target && isLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-muted-foreground">
          <Loader2 className="animate-spin" size={18} />
          <span className="t-body">Loading...</span>
        </div>
      )}

      {target && isError && (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-6">
          <AlertCircle className="mt-0.5 shrink-0 text-destructive" size={18} />
          <p className="t-body text-card-foreground">Couldn't load this title.</p>
        </div>
      )}

      {target && data && (
        <>
          <BookHeader
            data={{
              id: data.id,
              title: data.title,
              subtitle: data.subtitle,
              author: data.author,
              authorId: data.authorId ?? undefined,
              narrator: data.narrator,
              series: data.series ?? undefined,
              genre: data.genre,
              publishedYear: data.publishedYear,
              durationSec: data.durationSec,
              chapterCount: data.chapters.length,
              description: data.description,
            }}
          />

          {data.tracks.length > 0 ? (
            <>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={startListening}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <Play size={16} fill="currentColor" />
                  {data.progress && data.progress.currentTimeSec > 0 && !data.progress.isFinished
                    ? 'Resume'
                    : data.progress?.isFinished
                      ? 'Listen again'
                      : 'Start listening'}
                </button>
              </div>
              <div className="mt-6">
                <AudioPlayer chapters={data.chapters} totalDurationSec={data.durationSec} />
              </div>
            </>
          ) : (
            <p className="t-muted mt-8 text-[13px]">No audio tracks on this title.</p>
          )}
        </>
      )}
    </div>
  )
}
