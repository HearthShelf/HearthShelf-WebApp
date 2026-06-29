import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAudioPlayer } from '@/hooks/useAudioPlayer'
import {
  saveProgress,
  getItemDetail,
  type AbsChapter,
  type AbsTrack,
  type AbsTarget,
} from '@/api/absLibrary'
import { useQueueStore } from '@/store/queueStore'

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
  /** Stop playback and dismiss the now-playing book (clears the mini-player). */
  close: () => void
  playing: boolean
  positionSec: number
  togglePlay: () => void
  seekTo: (s: number) => void
  skip: (d: number) => void
  rate: number
  setRate: (r: number) => void
  volume: number
  setVolume: (v: number) => void
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

  const play = useCallback((n: NowPlaying) => setNow(n), [])

  // When a book finishes, auto-advance to the next queued item (unless the queue
  // is off). We pop the queue, load the item on the SAME server, and autoplay it.
  // Auto/playlist smart-fill modes still rely on the queue being pre-populated by
  // the UI; this just consumes whatever is up next.
  const onBookEnded = useCallback(() => {
    if (!target) return
    const q = useQueueStore.getState()
    if (q.mode === 'off') return
    const nextEntry = q.next()
    if (!nextEntry) return
    const t = target
    void getItemDetail(t, nextEntry.libraryItemId)
      .then((d) => {
        play({
          serverId: t.serverId,
          serverUrl: t.serverUrl,
          itemId: d.id,
          title: d.title,
          author: d.author,
          coverUrl: d.coverUrl,
          tracks: d.tracks,
          chapters: d.chapters,
          totalDurationSec: d.durationSec,
          startAtSec: d.progress?.currentTimeSec ?? 0,
          autoplay: true,
        })
      })
      .catch(() => {
        /* next item failed to load; stop rather than loop */
      })
  }, [target, play])

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
    onBookEnded,
  })

  // Dismiss the current book: pause first (so the <audio> stops and a final
  // progress save fires on pause), then clear now-playing so the mini-player
  // hides. Used by the swipe-to-dismiss gesture on the mini-player.
  const close = useCallback(() => {
    if (player.playing) player.togglePlay()
    setNow(null)
  }, [player])

  const api = useMemo<PlayerApi>(
    () => ({
      now,
      play,
      close,
      playing: player.playing,
      positionSec: player.positionSec,
      togglePlay: player.togglePlay,
      seekTo: player.seekTo,
      skip: player.skip,
      rate: player.rate,
      setRate: player.setRate,
      volume: player.volume,
      setVolume: player.setVolume,
      setSleepMinutes: player.setSleepMinutes,
      sleepArmed: player.sleepArmed,
      sleepRemainingMs: player.sleepRemainingMs,
    }),
    [now, play, close, player]
  )

  return <PlayerContext.Provider value={api}>{children}</PlayerContext.Provider>
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used within a <PlayerProvider>')
  return ctx
}
