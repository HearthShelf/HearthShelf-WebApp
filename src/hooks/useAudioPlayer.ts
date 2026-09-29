/**
 * Minimal multi-track audiobook player.
 *
 * A book is one or many audio files (or the server's quick-start parts of one
 * huge file); each track carries a cumulative startOffset, so the whole book is
 * one continuous timeline. One <audio> element is "active" at a time and we
 * translate between global book position and (track, local offset).
 *
 * A second, standby element starts loading the next track shortly before the
 * boundary. When the active track ends, the standby one takes over so the
 * handoff is close to seamless. Browsers that refuse to start a second element
 * without a tap fall back to swapping the src on the active element, which is
 * how every track change worked before.
 *
 * Progress is saved to ABS on a throttle and on pause/unmount, statelessly
 * (no play session). Streaming is direct to the server with a ?token= URL.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AbsTrack } from '@/api/absLibrary'
import { NEXT_TRACK_PRELOAD_SEC, trackIndexForPosition as indexForPosition } from '@/lib/bookParts'

interface UsePlayerArgs {
  tracks: AbsTrack[]
  totalDurationSec: number
  startAtSec: number
  /** Start playing as soon as the track set loads (vs. load paused). */
  autoplayOnLoad?: boolean
  /**
   * Called (throttled) to persist progress. `listenedSec` is the wall-clock time
   * the audio actually played since the last call (0 if it was only seeked/opened),
   * so callers can report true listened-time and skip no-op writes that would
   * clobber newer server-side progress.
   */
  onSaveProgress: (currentTimeSec: number, listenedSec: number) => void
  /** Called when the LAST track of the book finishes (for queue auto-advance). */
  onBookEnded?: () => void
  /**
   * Awaited right before playback resumes from a paused state, on EVERY resume
   * path - the app play button, hardware/lock-screen media keys, and the in-car
   * browser transport widget. Lets the owner re-check the server's resume point
   * after a long pause (the user may have listened on another device) and seek
   * there before audio starts. Resolve/return to proceed; may call seekTo first.
   */
  onBeforeResume?: () => void | Promise<void>
  /** Seconds for the seekbackward/seekforward/previoustrack/nexttrack OS and
   * car media-widget actions (Tesla's browser transport bar, hardware media
   * keys, Bluetooth head units). Defaults to 15/30. */
  seekBackwardSec?: number
  seekForwardSec?: number
  /** Build a fresh tokenized URL for a track right before it loads (tokens are
   *  short-lived and a long book reaches later tracks hours in). Falls back to
   *  the track's own `url` when omitted or when it returns null. */
  resolveUrl?: (track: AbsTrack) => string | null
}

/** Find the track index covering a global position (clamps to first/last track). */
function trackIndexForPosition(tracks: AbsTrack[], pos: number): number {
  return indexForPosition(
    tracks.map((t) => t.startOffsetSec),
    pos,
  )
}

/** Drop an element's source so it stops buffering and frees its memory. */
function releaseElement(el: HTMLAudioElement) {
  el.pause()
  el.removeAttribute('src')
  el.load()
}

export function useAudioPlayer({
  tracks,
  totalDurationSec,
  startAtSec,
  autoplayOnLoad = false,
  onSaveProgress,
  onBookEnded,
  onBeforeResume,
  seekBackwardSec = 15,
  seekForwardSec = 30,
  resolveUrl,
}: UsePlayerArgs) {
  // Latest resolveUrl, read at load time without re-subscribing anything.
  const resolveUrlRef = useRef(resolveUrl)
  resolveUrlRef.current = resolveUrl
  // Latest onBookEnded, read by the [tracks] effect without re-subscribing.
  const onBookEndedRef = useRef(onBookEnded)
  onBookEndedRef.current = onBookEnded
  // Latest onSaveProgress, read by the [tracks] effect's save() without
  // re-subscribing. Critical: the save closure is captured once per track set,
  // so a plain reference would keep calling a stale onSaveProgress after the
  // owner updated (e.g. repointed the play-session id on a 404 reopen) - the
  // stale closure would sync a dead session forever, looping 404->reopen and
  // hammering the server. Reading through a ref always uses the current one.
  const onSaveProgressRef = useRef(onSaveProgress)
  onSaveProgressRef.current = onSaveProgress
  // Latest onBeforeResume, read by resume() without re-subscribing handlers.
  const onBeforeResumeRef = useRef(onBeforeResume)
  onBeforeResumeRef.current = onBeforeResume
  // Guards against re-entrant resumes while an onBeforeResume is in flight (a
  // second play tap, or a media-key + button race), which would fire two server
  // checks and two play() calls.
  const resumingRef = useRef(false)
  // The element currently playing (or about to). Swapped with spareRef when the
  // standby element takes over at a track boundary.
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // Standby element: holds the NEXT track, loading ahead of the boundary.
  const spareRef = useRef<HTMLAudioElement | null>(null)
  // Track index the standby element holds, or -1.
  const spareIdxRef = useRef(-1)
  // Set once a browser refuses to start the standby element on its own; from
  // then on every track change reuses the active element (the old behaviour).
  const noHandoffRef = useRef(false)
  // Bumped on every load so a slow loadedmetadata from an earlier load can't
  // apply its stale seek offset.
  const loadSeqRef = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [positionSec, setPositionSec] = useState(startAtSec)
  const [ready, setReady] = useState(false)
  const [rate, setRateState] = useState(1)
  const [volume, setVolumeState] = useState(1)
  /** Sleep timer: epoch ms when playback should auto-pause, or null. */
  const [sleepAt, setSleepAt] = useState<number | null>(null)
  const currentTrackRef = useRef<number>(-1)
  const lastSaveRef = useRef<number>(0)
  // False from the moment a track src is set until loadedmetadata has applied the
  // intended seek offset. The browser fires timeupdate with currentTime=0 during
  // load (before we seek), so without this guard onTime records position 0 and a
  // throttled/teardown save would clobber a real resume point (e.g. 5h) with 0.
  const seekedRef = useRef(false)
  // Live global position + previous position, at HOOK scope so seekTo and saves
  // see the truth immediately - not effect-local, where a seek wouldn't update
  // them until the next timeupdate and a save in that gap wrote the stale value.
  const positionRef = useRef(startAtSec)
  const prevPosRef = useRef(startAtSec)
  // Read by the [tracks] init effect without making autoplay a dependency.
  const autoplayRef = useRef(autoplayOnLoad)
  autoplayRef.current = autoplayOnLoad

  // Lazily create the active + standby audio elements.
  if (!audioRef.current && typeof Audio !== 'undefined') {
    audioRef.current = new Audio()
    audioRef.current.preload = 'metadata'
    spareRef.current = new Audio()
    spareRef.current.preload = 'auto'
  }

  // Latest rate, read by loads and handoffs (loading a src resets the element's rate).
  const rateRef = useRef(1)
  // Apply playback rate to the element whenever it changes.
  const setRate = useCallback((r: number) => {
    setRateState(r)
    rateRef.current = r
    if (audioRef.current) audioRef.current.playbackRate = r
  }, [])

  // Latest volume, read by loadTrack on a track swap without making it a dep
  // (the sleep-fade ramp updates volume many times a second).
  const volumeRef = useRef(1)
  // Set the element volume (0..1). Used by the sleep timer's fade-out ramp.
  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v))
    volumeRef.current = clamped
    setVolumeState(clamped)
    if (audioRef.current) audioRef.current.volume = clamped
  }, [])

  // Sleep timer: pause when the deadline passes. setSleepMinutes(null) cancels.
  const setSleepMinutes = useCallback((minutes: number | null) => {
    setSleepAt(minutes == null ? null : Date.now() + minutes * 60_000)
  }, [])

  const urlFor = useCallback((track: AbsTrack) => resolveUrlRef.current?.(track) ?? track.url, [])

  // Seek `el` to a local offset once its metadata is in, then optionally play.
  // Blocks position tracking until the seek lands (a load fires timeupdate at
  // currentTime=0 first; recording that would clobber the resume point).
  const startAt = useCallback(
    (
      el: HTMLAudioElement,
      localOffsetSec: number,
      autoplay: boolean,
      onPlayFailed?: (e: unknown) => void,
    ) => {
      const seq = ++loadSeqRef.current
      seekedRef.current = false
      const apply = () => {
        if (seq !== loadSeqRef.current || el !== audioRef.current) return
        el.currentTime = Math.max(0, Math.min(localOffsetSec, el.duration || localOffsetSec))
        el.playbackRate = rateRef.current
        el.volume = volumeRef.current
        seekedRef.current = true
        if (autoplay) {
          void el.play().catch((e: unknown) => {
            if (onPlayFailed) onPlayFailed(e)
            else setPlaying(false)
          })
        }
      }
      if (el.readyState >= 1) apply()
      else el.addEventListener('loadedmetadata', apply, { once: true })
    },
    [],
  )

  // Load a given track and seek to a local offset, optionally autoplaying. When
  // the standby element already holds that track, hand playback over to it
  // instead of loading it from scratch.
  const loadTrack = useCallback(
    (index: number, localOffsetSec: number, autoplay: boolean) => {
      const audio = audioRef.current
      const spare = spareRef.current
      const track = tracks[index]
      if (!audio || !track) return
      if (spare && spareIdxRef.current === index && !spare.error && !noHandoffRef.current) {
        audioRef.current = spare
        spareRef.current = audio
        spareIdxRef.current = -1
        currentTrackRef.current = index
        startAt(spare, localOffsetSec, autoplay, (e) => {
          if (audioRef.current !== spare) return
          if (e instanceof DOMException && e.name === 'NotAllowedError') {
            // This browser won't start a second element without a tap. Go back
            // to the first element and just swap its src, now and from here on.
            noHandoffRef.current = true
            audioRef.current = audio
            spareRef.current = spare
            releaseElement(spare)
            const url = urlFor(track)
            if (!url) {
              setPlaying(false)
              return
            }
            audio.src = url
            audio.load()
            startAt(audio, localOffsetSec, true)
            return
          }
          setPlaying(false)
        })
        // Free the finished track's buffers. Kept loaded-but-idle it would hold
        // tens of MB for nothing.
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
        return
      }
      const url = urlFor(track)
      if (!url) return
      currentTrackRef.current = index
      // The standby is only useful when it holds the track right after this one.
      if (spare && spareIdxRef.current !== -1 && spareIdxRef.current !== index + 1) {
        spareIdxRef.current = -1
        releaseElement(spare)
      }
      audio.src = url
      audio.load()
      startAt(audio, localOffsetSec, autoplay)
    },
    [tracks, startAt, urlFor],
  )

  // Latest loadTrack + tracks for resume(), which is stable by design.
  const loadTrackRef = useRef(loadTrack)
  loadTrackRef.current = loadTrack
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks

  // Start loading the track after the current one into the standby element.
  const preloadNext = useCallback(
    (index: number) => {
      const spare = spareRef.current
      const track = tracks[index]
      if (!spare || !track || noHandoffRef.current) return
      const url = urlFor(track)
      if (!url) return
      spareIdxRef.current = index
      spare.src = url
      spare.load()
    },
    [tracks, urlFor],
  )

  // Seek to a global book position.
  const seekTo = useCallback(
    (globalSec: number) => {
      if (tracks.length === 0) return
      const pos = Math.max(0, Math.min(globalSec, totalDurationSec))
      const idx = trackIndexForPosition(tracks, pos)
      const local = pos - tracks[idx].startOffsetSec
      setPositionSec(pos)
      // Seed the saved-position refs NOW so any save before the next timeupdate
      // (pause/teardown right after a seek) reports where we seeked to, not the
      // stale prior position. prevPosRef too, so this jump isn't counted as
      // listened time.
      positionRef.current = pos
      prevPosRef.current = pos
      if (idx !== currentTrackRef.current) {
        loadTrack(idx, local, playing)
      } else if (audioRef.current) {
        audioRef.current.currentTime = local
      }
    },
    [tracks, totalDurationSec, playing, loadTrack],
  )

  // Resume from paused, giving onBeforeResume a chance to re-sync the position
  // first. Shared by the app play button and every OS/car media-key play action
  // so the stale-resume check can't be bypassed by pressing play on the widget.
  const resume = useCallback(() => {
    if (!audioRef.current || !audioRef.current.paused || resumingRef.current) return
    const before = onBeforeResumeRef.current
    // Start playback on whichever element is active by then. If onBeforeResume
    // seeked ACROSS a track boundary, a new src is still loading and seekedRef
    // is false until loadedmetadata applies the resume offset - playing now
    // would briefly play the new track from 0. Wait for the seek to land, then play.
    const playWhenSeeked = () => {
      const audio = audioRef.current
      if (!audio) return
      // The track failed to load (e.g. the server was still preparing it, or the
      // connection dropped): reload it where we are instead of retrying a dead
      // element forever.
      if (audio.error && currentTrackRef.current >= 0) {
        const idx = currentTrackRef.current
        const start = tracksRef.current[idx]?.startOffsetSec ?? 0
        currentTrackRef.current = -1
        loadTrackRef.current(idx, Math.max(0, positionRef.current - start), true)
        return
      }
      if (seekedRef.current) {
        void audio.play().catch(() => setPlaying(false))
        return
      }
      audio.addEventListener(
        'loadedmetadata',
        () => void audio.play().catch(() => setPlaying(false)),
        { once: true },
      )
    }
    if (!before) {
      playWhenSeeked()
      return
    }
    resumingRef.current = true
    void Promise.resolve()
      .then(() => before())
      .catch(() => {}) // never block playback on a failed re-sync
      .finally(() => {
        resumingRef.current = false
        playWhenSeeked()
      })
  }, [])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) resume()
    else audio.pause()
  }, [resume])

  const skip = useCallback(
    (deltaSec: number) => seekTo(positionSec + deltaSec),
    [positionSec, seekTo],
  )

  // Wire audio element events. Re-run when track set changes. Both elements get
  // the same handlers; only events from the ACTIVE one count (the standby fires
  // its own load events while it preloads).
  useEffect(() => {
    const elements = [audioRef.current, spareRef.current].filter(
      (el): el is HTMLAudioElement => el != null,
    )
    if (elements.length === 0 || tracks.length === 0) return
    const isActive = (e: Event) => e.currentTarget === audioRef.current

    // Wall-clock seconds actually played since the last save. Built from the
    // gap between timeupdate events while playing (seeks/opens don't add to it),
    // so we report true listened-time and never write progress the user never
    // reached. Drained on every save.
    const listenedRef = { current: 0 }

    const save = (force = false) => {
      const now = Date.now()
      if (force || now - lastSaveRef.current > 10_000) {
        lastSaveRef.current = now
        const listened = listenedRef.current
        listenedRef.current = 0
        // Only persist when the user actually engaged: real played-time, or a
        // deliberate seek away from the seed position. A bare open/teardown that
        // never moved must not echo startAtSec back and clobber newer progress
        // (e.g. progress made on another device since this book was opened).
        const moved = positionRef.current !== startAtSec
        if (listened > 0 || moved) onSaveProgressRef.current(positionRef.current, listened)
      }
    }

    const onTime = (e: Event) => {
      if (!isActive(e)) return
      const audio = e.currentTarget as HTMLAudioElement
      // Ignore the timeupdate(s) the browser fires at currentTime=0 while a track
      // is still loading - we haven't applied the resume seek yet, so this is not
      // a real position and must not be recorded or saved.
      if (!seekedRef.current) return
      const idx = currentTrackRef.current
      const base = tracks[idx]?.startOffsetSec ?? 0
      const global = base + audio.currentTime
      // Close to the end of this track (in listening time, so fast speeds start
      // earlier): get the next one loading in the standby element.
      const next = idx + 1
      if (
        next < tracks.length &&
        spareIdxRef.current !== next &&
        !audio.paused &&
        audio.duration - audio.currentTime <=
          NEXT_TRACK_PRELOAD_SEC * Math.max(1, audio.playbackRate)
      ) {
        preloadNext(next)
      }
      // A small forward step at ~playback rate is real listening; a large jump
      // is a seek/track-swap and contributes no listened-time.
      const step = global - prevPosRef.current
      if (step > 0 && step < 10) listenedRef.current += step
      prevPosRef.current = global
      positionRef.current = global
      setPositionSec(global)
      save()
    }
    const onPlay = (e: Event) => {
      if (isActive(e)) setPlaying(true)
    }
    const onPause = (e: Event) => {
      if (!isActive(e)) return
      // A track reaching its end also fires 'pause'. Between two tracks of the
      // same book that is not a real pause: stay "playing" so the lock screen and
      // car widget don't flicker, and let 'ended' move on to the next track.
      const audio = e.currentTarget as HTMLAudioElement
      if (audio.ended && currentTrackRef.current < tracks.length - 1) return
      setPlaying(false)
      save(true)
    }
    const onEnded = (e: Event) => {
      if (!isActive(e)) return
      // Advance to the next track, or end the book.
      const next = currentTrackRef.current + 1
      if (next < tracks.length) {
        loadTrack(next, 0, true)
      } else {
        setPlaying(false)
        save(true)
        // Book finished: let the queue play the next item, if any.
        onBookEndedRef.current?.()
      }
    }
    const onCanPlay = (e: Event) => {
      if (isActive(e)) setReady(true)
    }
    const onError = (e: Event) => {
      if (isActive(e)) {
        setPlaying(false)
        return
      }
      // The standby failed to load: forget it, the boundary will load normally.
      if (e.currentTarget === spareRef.current) spareIdxRef.current = -1
    }

    const listeners: Array<[string, (e: Event) => void]> = [
      ['timeupdate', onTime],
      ['play', onPlay],
      ['pause', onPause],
      ['ended', onEnded],
      ['canplay', onCanPlay],
      ['error', onError],
    ]
    for (const el of elements) {
      for (const [type, fn] of listeners) el.addEventListener(type, fn)
    }

    // Reset the saved-position baseline to THIS book's resume point before the
    // initial load, so a stale prior-book position can't leak into a save.
    positionRef.current = startAtSec
    prevPosRef.current = startAtSec
    setPositionSec(startAtSec)
    // A new book: nothing in the standby element belongs to it.
    spareIdxRef.current = -1
    // Initial load at the saved position; autoplay if the caller requested it.
    const idx = trackIndexForPosition(tracks, startAtSec)
    loadTrack(idx, startAtSec - tracks[idx].startOffsetSec, autoplayRef.current)

    return () => {
      for (const el of elements) {
        for (const [type, fn] of listeners) el.removeEventListener(type, fn)
      }
      audioRef.current?.pause()
      if (spareRef.current && spareIdxRef.current !== -1) releaseElement(spareRef.current)
      spareIdxRef.current = -1
      save(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks])

  // Sleep timer: when the deadline passes, pause. Checked on a 1s tick while
  // armed and playing.
  useEffect(() => {
    if (sleepAt == null) return
    const id = window.setInterval(() => {
      if (Date.now() >= sleepAt) {
        audioRef.current?.pause()
        setSleepAt(null)
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [sleepAt])

  // Media Session: lock-screen / media-key / in-car browser transport controls
  // (this is what puts working skip buttons on Tesla's browser media widget,
  // Android Auto/CarPlay browser tabs, and hardware media keys generally).
  //
  // Some Chromium builds (Tesla's embedded browser among them) throw a
  // TypeError from setActionHandler for actions they don't recognize -
  // 'seekto' and 'stop' are the usual suspects. setActionHandler calls are
  // synchronous and NOT independent: one throwing mid-list aborts every call
  // after it, so an unsupported 'seekto' was silently wiping out the
  // seekbackward/seekforward/previoustrack/nexttrack handlers registered
  // after it. Each handler is now wrapped so one unsupported action can't
  // take the rest down with it.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler)
      } catch {
        // Unsupported action on this browser - skip it, don't abort the rest.
      }
    }
    setHandler('play', () => resume())
    setHandler('pause', () => audioRef.current?.pause())
    setHandler('seekbackward', () => skip(-seekBackwardSec))
    setHandler('seekforward', () => skip(seekForwardSec))
    // `seekto` lets the OS/car transport widget's own scrubber drag directly,
    // instead of only exposing +/- skip buttons.
    setHandler('seekto', (details) => {
      if (details.seekTime == null) return
      seekTo(details.seekTime)
    })
    // Some widgets (Tesla's browser media bar among them) have no dedicated
    // seekbackward/seekforward buttons at all - previous/next-track are the
    // ONLY skip affordance they render. Map them to the same second-based
    // skip rather than chapter navigation, so those widgets get a working
    // skip control instead of two permanently-disabled buttons.
    setHandler('previoustrack', () => skip(-seekBackwardSec))
    setHandler('nexttrack', () => skip(seekForwardSec))
    ms.playbackState = playing ? 'playing' : 'paused'
    return () => {
      setHandler('play', null)
      setHandler('pause', null)
      setHandler('seekbackward', null)
      setHandler('seekforward', null)
      setHandler('seekto', null)
      setHandler('previoustrack', null)
      setHandler('nexttrack', null)
    }
  }, [playing, skip, seekTo, resume, seekBackwardSec, seekForwardSec])

  // Keep the OS/car transport widget's own progress bar in sync with real
  // position + duration + rate, so it can render a live scrubber and drag-seek
  // (not just skip buttons) - Tesla's browser media widget shows this. Always
  // the whole book's timeline, never the current track's.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return
    if (!totalDurationSec || !Number.isFinite(totalDurationSec)) return
    try {
      navigator.mediaSession.setPositionState({
        duration: totalDurationSec,
        position: Math.min(positionSec, totalDurationSec),
        playbackRate: rate,
      })
    } catch {
      // Some browsers throw if position/duration briefly disagree mid-track-swap;
      // the next tick's update corrects it, so a failed call here is harmless.
    }
  }, [positionSec, totalDurationSec, rate])

  const sleepRemainingMs = sleepAt == null ? null : Math.max(0, sleepAt - Date.now())

  return {
    playing,
    positionSec,
    ready,
    rate,
    setRate,
    volume,
    setVolume,
    togglePlay,
    seekTo,
    skip,
    setSleepMinutes,
    sleepArmed: sleepAt != null,
    sleepRemainingMs,
  }
}
