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
  openPlaySession,
  getItemDetail,
  getItemProgress,
  type AbsChapter,
  type AbsTrack,
  type AbsTarget,
} from '@/api/absLibrary'
import { useQueueStore } from '@/store/queueStore'
import { getServerQueue } from '@/api/absQueue'
import { useSettingsStore } from '@/store/settingsStore'
import {
  syncStateStartSession,
  syncStateTick,
  syncStateSynced,
  syncStatePending,
  syncStateFailed,
  syncStateSeeked,
  syncStateClear,
  getSyncState,
} from '@/player/syncState'
import { recordLocalSession, flushPendingProgress } from '@/player/pendingProgress'

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
  /** Push the current spot + any banked listened-time to the server now, and
   *  flush offline-banked sessions. Resolves true when something reached the
   *  server. Drives the sync-status pill's "Sync now" button. */
  forceSyncNow: () => Promise<boolean>
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

  // Sync-status bookkeeping for the live "Now" session (drives the header pill and
  // the live Recent Listens row). `startedAt` stamps when this listen began;
  // `unsynced` is listened-time reported to a sync that failed, banked for retry.
  const sessionStartedAtRef = useRef<number>(Date.now())
  const unsyncedRef = useRef<number>(0)
  // Latest `now`, so the visibilitychange / flush closures can read the current
  // book without re-subscribing on every field change.
  const nowRef = useRef<NowPlaying | null>(null)
  nowRef.current = now

  // Start (or restart) the live sync session whenever a new book loads. Green to
  // begin with - a fresh session has nothing outstanding yet.
  useEffect(() => {
    if (!now) {
      syncStateClear()
      return
    }
    sessionStartedAtRef.current = Date.now()
    unsyncedRef.current = 0
    syncStateStartSession(now.itemId, sessionStartedAtRef.current, now.startAtSec)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now?.itemId, now?.serverId])

  // After progress lands on ABS, refresh the views that read it (home hero,
  // shelves, in-progress) so they don't serve a stale snapshot.
  const refreshProgress = useCallback(
    (serverId: string) => {
      void qc.invalidateQueries({ queryKey: ['abs-media-progress', serverId] })
      void qc.invalidateQueries({ queryKey: ['abs-items-in-progress', serverId] })
    },
    [qc],
  )

  // Push the current position + any banked listened-time to the server right now
  // (the sync pill's "Sync now" tap). Always sends, even with zero fresh
  // listened-time, so a seek-while-paused lands the new spot. Also flushes any
  // offline-banked sessions. Returns true when something reached the server.
  const forceSyncNow = useCallback(async (): Promise<boolean> => {
    const cur = nowRef.current
    const t: AbsTarget | null = cur
      ? { serverId: cur.serverId, serverUrl: cur.serverUrl }
      : null
    if (!t) return false
    let live = false
    if (cur?.playSessionId) {
      const listened = unsyncedRef.current
      const res = await syncPlaySession(
        t,
        cur.playSessionId,
        positionRef.current,
        listened,
        cur.totalDurationSec,
      )
      if (res === 'ok') {
        unsyncedRef.current = 0
        syncStateSynced(Date.now())
        refreshProgress(t.serverId)
        live = true
      } else if (res === 'failed') {
        syncStateFailed()
      }
    }
    const flushed = await flushPendingProgress(t)
    return live || flushed
  }, [refreshProgress])

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
        useQueueStore
          .getState()
          .adoptServer(server.items, server.manual, server.playlistId, server.updatedAt)
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
        const t = target
        const item = now
        // Keep the live "Now" row's position + accrued listened-time current
        // every tick (no status change - a normal tick doesn't flip the pill).
        const liveTotal = (getSyncState().live?.timeListening ?? 0) + listened
        syncStateTick(sec, liveTotal)
        // Stateless progress PATCH keeps the resume point current.
        void saveProgress(t, item.itemId, sec, item.totalDurationSec).then(() =>
          refreshProgress(t.serverId),
        )
        // AND sync the open play session so ABS accrues listening time + records
        // a session (the PATCH alone never does - that's why stats showed 0h).
        // `listened` is real wall-clock played-time, which ABS ADDS to the
        // session total - reporting a position delta here counted seeks as
        // listening and inflated history.
        if (!item.playSessionId) return
        // Fold this tick's listened-time into the outstanding total, so a sync
        // that failed earlier retries its banked time on the next tick.
        unsyncedRef.current += listened
        const outstanding = unsyncedRef.current
        // Nothing new to send AND we're already synced: don't churn the pill.
        if (outstanding <= 0 && getSyncState().status === 'synced') return
        syncStatePending()
        void syncPlaySession(
          t,
          item.playSessionId,
          sec,
          outstanding,
          item.totalDurationSec,
        ).then((res) => {
          if (res === 'ok') {
            unsyncedRef.current = 0
            syncStateSynced(Date.now())
          } else if (res === 'gone') {
            // ABS forgot this session (restart/expiry). Reopen and re-point so
            // the next tick syncs against a live id instead of failing forever.
            void openPlaySession(t, item.itemId).then((newId) => {
              if (!newId) {
                syncStateFailed()
                return
              }
              setNow((cur) =>
                cur && cur.itemId === item.itemId && cur.playSessionId === item.playSessionId
                  ? { ...cur, playSessionId: newId }
                  : cur,
              )
            })
          } else {
            // Connection dropped: keep the listened-time banked (unsyncedRef is
            // untouched) AND bank a replayable offline session, then go red.
            recordLocalSession({
              id: `play_local_${item.itemId}_${sessionStartedAtRef.current}`,
              libraryItemId: item.itemId,
              mediaType: 'book',
              displayTitle: item.title,
              duration: item.totalDurationSec,
              currentTime: sec,
              timeListening: liveTotal,
              startedAt: sessionStartedAtRef.current,
              updatedAt: Date.now(),
            })
            syncStateFailed()
          }
        })
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

  // Wrap seek so a manual scrub moves the server's position out of date: go
  // ember (pending) and slide the live row's spot, matching the mobile app.
  const seekTo = useCallback(
    (s: number) => {
      player.seekTo(s)
      syncStateSeeked(s)
    },
    [player],
  )
  const skip = useCallback(
    (d: number) => {
      player.skip(d)
      syncStateSeeked(positionRef.current + d)
    },
    [player],
  )
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
    syncStateClear()
    setNow(null)
  }, [player, target, now, refreshProgress])

  // Close the open ABS play session when the tab is going away, so a browser
  // session that's never explicitly dismissed (the overwhelmingly common case -
  // closing the tab, navigating off-site, the Tesla browser tearing down on
  // power-off) still gets persisted into listening history. Without this, only
  // the position PATCH (a separate mechanism, see onSaveProgress above) kept
  // resuming-elsewhere working, while the session itself stayed open in ABS's
  // memory forever and never appeared in "Previous sessions".
  //
  // `visibilitychange`->hidden fires reliably (tab switch, app switch, screen
  // off) and is our primary signal; `pagehide` covers the actual unload. Both
  // use `fetch(..., {keepalive:true})` (via closePlaySession -> absPost) so the
  // request survives navigation - a plain fetch can be cancelled mid-flight on
  // unload. We deliberately do NOT clear `now`/pause playback here: the tab may
  // just be backgrounded and resume shortly (audio keeps playing), matching how
  // the mobile app only closes on an actual stop/background-kill, not on every
  // hide.
  //
  // If the tab comes back while the same book is still loaded, the closed
  // session id is gone from ABS's memory (GET /api/session/:id only finds OPEN
  // sessions) - syncing against it would silently fail forever via the
  // onSaveProgress catch. So on becoming visible again after a hide-close, open
  // a fresh session and swap it into `now` before any further sync fires.
  useEffect(() => {
    if (!target || !now?.playSessionId) return
    const sessionId = now.playSessionId
    const itemId = now.itemId
    const t = target
    const durationSec = now.totalDurationSec
    let closed = false
    const closeOnce = () => {
      if (closed) return
      closed = true
      void closePlaySession(t, sessionId, positionRef.current, 0, durationSec)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        closeOnce()
      } else if (closed) {
        void openPlaySession(t, itemId).then((newSessionId) => {
          if (!newSessionId) return
          setNow((cur) =>
            cur && cur.itemId === itemId && cur.playSessionId === sessionId
              ? { ...cur, playSessionId: newSessionId }
              : cur,
          )
        })
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', closeOnce)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', closeOnce)
    }
  }, [target, now?.itemId, now?.playSessionId, now?.totalDurationSec])

  // Flush offline-banked sessions when the browser reports it's back online (and
  // once on mount, in case a prior tab banked sessions the server never received).
  // Best-effort: a failed flush leaves everything banked for the next reconnect.
  useEffect(() => {
    const flush = () => {
      const cur = nowRef.current
      const t: AbsTarget | null = cur
        ? { serverId: cur.serverId, serverUrl: cur.serverUrl }
        : null
      if (t) void flushPendingProgress(t)
    }
    flush()
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [])

  const api = useMemo<PlayerApi>(
    () => ({
      now,
      play,
      close,
      playing: player.playing,
      positionSec: player.positionSec,
      togglePlay: player.togglePlay,
      seekTo,
      skip,
      rate: player.rate,
      setRate: player.setRate,
      volume: player.volume,
      setVolume: player.setVolume,
      setSleepMinutes: player.setSleepMinutes,
      sleepArmed: player.sleepArmed,
      sleepRemainingMs: player.sleepRemainingMs,
      forceSyncNow,
    }),
    [now, play, close, player, seekTo, skip, forceSyncNow],
  )

  return <PlayerContext.Provider value={api}>{children}</PlayerContext.Provider>
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used within a <PlayerProvider>')
  return ctx
}
