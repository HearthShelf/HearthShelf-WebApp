import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAudioPlayer } from '@/hooks/useAudioPlayer'
import {
  saveProgress,
  syncPlaySession,
  closePlaySession,
  getItemDetail,
  getItemProgress,
  type AbsChapter,
  type AbsTrack,
  type AbsTarget,
} from '@/api/absLibrary'
import { useQueueStore } from '@/store/queueStore'
import { getServerQueue } from '@/api/absQueue'
import { useSettingsStore } from '@/store/settingsStore'

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
  narrator?: string
  coverUrl: string | null
  tracks: AbsTrack[]
  chapters: AbsChapter[]
  totalDurationSec: number
  startAtSec: number
  /** Start playing immediately on load (vs. load paused). */
  autoplay?: boolean
  /** Open ABS play session to sync listened time to (drives stats + sessions). */
  playSessionId?: string | null
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
  const qc = useQueryClient()
  const skipForward = useSettingsStore((s) => s.skipForward)
  const skipBack = useSettingsStore((s) => s.skipBack)
  const defaultSpeed = useSettingsStore((s) => s.defaultSpeed)

  const target: AbsTarget | null = now ? { serverId: now.serverId, serverUrl: now.serverUrl } : null

  const play = useCallback((n: NowPlaying) => {
    setNow(n)
  }, [])

  // Wall-clock ms when playback last paused (or the book was opened paused), so
  // the pre-resume check can tell "just tapped pause/play" from "sat paused for
  // hours while I listened on another device". Reset when a new book loads.
  const pausedSinceRef = useRef<number>(Date.now())
  // Live copies of position + seekTo so the stable onBeforeResume callback (it
  // must not re-subscribe the hook's media-key handlers on every tick) can read
  // the current position and seek without depending on `player`, which is
  // defined below and changes identity each render.
  const positionRef = useRef(0)
  const seekToRef = useRef<(s: number) => void>(() => {})

  // After progress lands on ABS, refresh the views that read it (home hero,
  // shelves, in-progress) so they don't serve a stale snapshot.
  const refreshProgress = useCallback(
    (serverId: string) => {
      void qc.invalidateQueries({ queryKey: ['abs-media-progress', serverId] })
      void qc.invalidateQueries({ queryKey: ['abs-items-in-progress', serverId] })
    },
    [qc],
  )

  // When a book finishes, auto-advance to the next queued item (unless the queue
  // is off). We pop the queue, load the item on the SAME server, and autoplay it.
  // The server owns the queue: pull it fresh first (Auto recomputes on GET, so
  // it reflects the book that just finished), then consume the head.
  const onBookEnded = useCallback(() => {
    if (!target) return
    const t = target
    void (async () => {
      if (useQueueStore.getState().mode === 'off') return
      try {
        const server = await getServerQueue(t)
        useQueueStore.getState().adoptServer(server.items, server.playlistId, server.updatedAt)
      } catch {
        // offline / unreachable: fall back to the local queue below
      }
      const nextEntry = useQueueStore.getState().next()
      if (!nextEntry) return
      try {
        const d = await getItemDetail(t, nextEntry.libraryItemId)
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
          playSessionId: d.playSessionId,
          autoplay: true,
        })
      } catch {
        /* next item failed to load; stop rather than loop */
      }
    })()
  }, [target, play])

  const player = useAudioPlayer({
    // Empty until something is playing; the hook tolerates an empty track set.
    tracks: now?.tracks ?? [],
    totalDurationSec: now?.totalDurationSec ?? 0,
    startAtSec: now?.startAtSec ?? 0,
    autoplayOnLoad: now?.autoplay ?? false,
    seekBackwardSec: skipBack,
    seekForwardSec: skipForward,
    onSaveProgress: useCallback(
      (sec: number, listened: number) => {
        if (!target || !now) return
        // Stateless progress PATCH keeps the resume point current.
        void saveProgress(target, now.itemId, sec, now.totalDurationSec).then(() =>
          refreshProgress(target.serverId),
        )
        // AND sync the open play session so ABS accrues listening time + records
        // a session (the PATCH alone never does - that's why stats showed 0h).
        // `listened` is real wall-clock played-time, which ABS ADDS to the
        // session total - reporting a position delta here counted seeks as
        // listening and inflated history.
        if (now.playSessionId && listened > 0) {
          void syncPlaySession(target, now.playSessionId, sec, listened, now.totalDurationSec)
        }
      },
      [target, now, refreshProgress],
    ),
    onBookEnded,
    // Before resuming from a pause, re-check the server's resume point. The user
    // may have listened elsewhere (phone, another PC, the car) since this tab
    // last played, leaving our in-memory position stale. If the server is
    // meaningfully ahead of (or behind) where we're about to resume, jump there
    // so we pick up where they actually left off - and don't clobber that newer
    // progress by saving our stale position on the next pause. Fires on every
    // resume path (app button, media keys, in-car transport widget).
    //
    // Only after a 5 min pause, and only when the gap is > 30s, so ordinary
    // pause/resume and tiny clock skew never yank the position.
    onBeforeResume: async () => {
      if (!target || !now) return
      if (Date.now() - pausedSinceRef.current < 5 * 60_000) return
      try {
        const server = await getItemProgress(target, now.itemId)
        if (server && !server.isFinished) {
          if (Math.abs(server.currentTimeSec - positionRef.current) > 30) {
            seekToRef.current(server.currentTimeSec)
          }
        }
      } catch {
        // Offline / unreachable: resume from the local position.
      }
    },
  })

  // Keep the refs the onBeforeResume closure reads in sync with the live player.
  positionRef.current = player.positionSec
  seekToRef.current = player.seekTo
  // Track when we entered a paused state, for the long-pause resync threshold.
  useEffect(() => {
    if (!player.playing) pausedSinceRef.current = Date.now()
  }, [player.playing])
  useEffect(() => {
    pausedSinceRef.current = Date.now()
  }, [now?.itemId])

  // OS/car media-widget metadata (title, author, cover art). Lives here - not on
  // the book detail page - because playback (and the mini-player) outlives that
  // page: navigating away used to null out mediaSession.metadata while audio
  // kept playing, which is why Tesla's widget degraded to a bare stop button
  // with no track info once you left the "now playing" screen.
  useEffect(() => {
    if (!now || !('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: now.title,
      artist: now.author,
      album: now.narrator ? `Narrated by ${now.narrator}` : undefined,
      artwork: now.coverUrl ? [{ src: now.coverUrl, sizes: '480x480' }] : undefined,
    })
    return () => {
      navigator.mediaSession.metadata = null
    }
  }, [now])

  // Dismiss the current book: pause first (so the <audio> stops and a final
  // progress save fires on pause), then clear now-playing so the mini-player
  // hides. Used by the swipe-to-dismiss gesture on the mini-player.
  useEffect(() => {
    if (now) player.setRate(defaultSpeed)
  }, [now?.itemId, defaultSpeed, player.setRate])

  const close = useCallback(() => {
    if (player.playing) player.togglePlay()
    // Pausing above flushes a final progress + listened-time sync. Here we just
    // mark the session closed at the final position (listened-time already
    // accrued via the sync path; reporting it again would double-count it).
    if (target && now?.playSessionId) {
      void closePlaySession(target, now.playSessionId, player.positionSec, 0, now.totalDurationSec)
      refreshProgress(target.serverId)
    }
    setNow(null)
  }, [player, target, now, refreshProgress])

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
    [now, play, close, player],
  )

  return <PlayerContext.Provider value={api}>{children}</PlayerContext.Provider>
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used within a <PlayerProvider>')
  return ctx
}
