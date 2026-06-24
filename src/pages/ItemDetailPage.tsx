import { useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react'
import { useServer } from '@/hooks/useServers'
import { getItemDetail, saveProgress, type AbsTarget } from '@/api/absLibrary'
import { hasAbsToken } from '@/lib/absTokens'
import { AudioPlayer } from '@/components/AudioPlayer'
import { BookHeader } from '@/components/shared/BookHeader'
import { WebAppMediaUIProvider } from '@/components/shared/WebAppMediaUI'

/**
 * Item detail + player. Loads the expanded item (tracks + saved progress) and
 * mounts the audio player. Requires an active connection to the server (the
 * library grid is the entry point, so a token already exists); if not, points
 * the user back to connect.
 */
export function ItemDetailPage() {
  const { serverId, itemId } = useParams()
  const server = useServer(serverId)
  const target: AbsTarget | null =
    serverId && server ? { serverId, serverUrl: server.url } : null
  const connected = serverId ? hasAbsToken(serverId) : false

  const { data, isLoading, isError } = useQuery({
    queryKey: ['abs-item', serverId, itemId],
    queryFn: () => getItemDetail(target as AbsTarget, itemId as string),
    enabled: Boolean(target && itemId && connected),
  })

  const progress = useMutation({
    mutationFn: (currentTimeSec: number) =>
      saveProgress(target as AbsTarget, itemId as string, currentTimeSec, data?.durationSec ?? 0),
  })

  // Lock-screen / media-key metadata. Action handlers live in the player hook.
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

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to={serverId ? `/server/${serverId}` : '/'}
        className="t-muted mb-6 inline-flex items-center gap-1.5 text-[13px] hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Back to library
      </Link>

      {!connected && (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="t-body text-card-foreground">Connect to this server first.</p>
          <Link to={serverId ? `/server/${serverId}` : '/'} className="t-muted mt-2 inline-block text-[13px] underline">
            Go to the library
          </Link>
        </div>
      )}

      {connected && isLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-muted-foreground">
          <Loader2 className="animate-spin" size={18} />
          <span className="t-body">Loading...</span>
        </div>
      )}

      {connected && isError && (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-6">
          <AlertCircle className="mt-0.5 shrink-0 text-destructive" size={18} />
          <p className="t-body text-card-foreground">Couldn't load this title.</p>
        </div>
      )}

      {connected && data && target && (
        <WebAppMediaUIProvider target={target}>
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
            <div className="mt-8">
              <AudioPlayer
                tracks={data.tracks}
                chapters={data.chapters}
                totalDurationSec={data.durationSec}
                startAtSec={data.progress?.currentTimeSec ?? 0}
                onSaveProgress={(s) => progress.mutate(s)}
              />
            </div>
          ) : (
            <p className="t-muted mt-8 text-[13px]">No audio tracks on this title.</p>
          )}
        </WebAppMediaUIProvider>
      )}
    </div>
  )
}
