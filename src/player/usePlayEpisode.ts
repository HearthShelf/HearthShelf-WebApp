import { useCallback } from 'react'
import { usePlayer } from '@/player/PlayerProvider'
import { useActiveServer } from '@/hooks/useActiveServer'
import { itemCoverUrl } from '@/api/absLibrary'
import { getPlayableEpisode } from '@/api/absPodcasts'

/**
 * Play a single podcast episode through the global player.
 *
 * A podcast episode is one audio file, so its play session yields a single
 * AbsTrack at offset 0. We shape that into a NowPlaying descriptor - the same
 * player that drives books - using the parent show's cover and the episode's
 * own title. Progress is keyed (and saved) by the parent libraryItemId, matching
 * how ABS tracks episode progress.
 */
export function usePlayEpisode(): (args: {
  itemId: string
  episodeId: string
  episodeTitle: string
  podcastTitle: string
}) => Promise<void> {
  const player = usePlayer()
  const { target } = useActiveServer()

  return useCallback(
    async ({ itemId, episodeId, episodeTitle, podcastTitle }) => {
      if (!target) return
      const session = await getPlayableEpisode(target, itemId, episodeId)
      if (session.tracks.length === 0) return
      player.play({
        serverId: target.serverId,
        serverUrl: target.serverUrl,
        itemId,
        title: episodeTitle,
        author: podcastTitle,
        coverUrl: itemCoverUrl(target, itemId, 480),
        tracks: session.tracks,
        chapters: [],
        totalDurationSec: session.totalDurationSec,
        startAtSec: session.currentTimeSec,
        autoplay: true,
      })
    },
    [player, target]
  )
}
