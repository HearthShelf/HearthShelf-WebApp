import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAudioPlayer } from '@/hooks/useAudioPlayer'
import { saveProgress, type AbsChapter, type AbsTrack, type AbsTarget } from '@/api/absLibrary'

/**
 * App-level playback. One <audio> element lives here (via useAudioPlayer), so a
 * book keeps playing as the user navigates between pages. The item page and the
 * docked mini-player both drive and read THIS single player.
 *
 * `play()` swaps the now-playing book; useAudioPlayer re-inits on the new track
 * set. Progress saves go to the originating server (captured in the descriptor).
 */
export interface NowPlaying {
  serverId: string
  serverUrl: string
  itemId: string
  title: string
  author?: string
  coverUrl: string | null
  tracks: AbsTrack[]
  chapters: AbsChapter[]
  totalDurationSec: number
  startAtSec: number
  /** Start playing immediately on load (vs. load paused). */
  autoplay?: boolean
}

interface PlayerApi {
  now: NowPlaying | null
  play: (n: NowPlaying) => void
  playing: boolean
  positionSec: number
  togglePlay: () => void
  seekTo: (s: number) => void
  skip: (d: number) => void
  rate: number
  setRate: (r: number) => void
  setSleepMinutes: (m: number | null) => void
  sleepArmed: boolean
  sleepRemainingMs: number | null
}

const PlayerContext = createContext<PlayerApi | null>(null)

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState<NowPlaying | null>(null)

  const target: AbsTarget | null = now
    ? { serverId: now.serverId, serverUrl: now.serverUrl }
    : null

  const player = useAudioPlayer({
    // Empty until something is playing; the hook tolerates an empty track set.
    tracks: now?.tracks ?? [],
    totalDurationSec: now?.totalDurationSec ?? 0,
    startAtSec: now?.startAtSec ?? 0,
    autoplayOnLoad: now?.autoplay ?? false,
    onSaveProgress: useCallback(
      (sec: number) => {
        if (target && now) void saveProgress(target, now.itemId, sec, now.totalDurationSec)
      },
      [target, now]
    ),
  })

  const play = useCallback((n: NowPlaying) => setNow(n), [])

  const api = useMemo<PlayerApi>(
    () => ({
      now,
      play,
      playing: player.playing,
      positionSec: player.positionSec,
      togglePlay: player.togglePlay,
      seekTo: player.seekTo,
      skip: player.skip,
      rate: player.rate,
      setRate: player.setRate,
      setSleepMinutes: player.setSleepMinutes,
      sleepArmed: player.sleepArmed,
      sleepRemainingMs: player.sleepRemainingMs,
    }),
    [now, play, player]
  )

  return <PlayerContext.Provider value={api}>{children}</PlayerContext.Provider>
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used within a <PlayerProvider>')
  return ctx
}
