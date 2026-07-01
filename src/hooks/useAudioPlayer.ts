/**
 * Minimal multi-track audiobook player over a single <audio> element.
 *
 * A book is one or many audio files; each track carries a cumulative
 * startOffset, so the whole book is one continuous timeline. We keep one <audio>
 * element and swap its src as playback crosses track boundaries, translating
 * between global book position and (track, local offset).
 *
 * Progress is saved to ABS on a throttle and on pause/unmount, statelessly
 * (no play session). Streaming is direct to the server with a ?token= URL.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AbsTrack } from '@/api/absLibrary'

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
  /** Seconds for the seekbackward/seekforward/previoustrack/nexttrack OS and
   * car media-widget actions (Tesla's browser transport bar, hardware media
   * keys, Bluetooth head units). Defaults to 15/30. */
  seekBackwardSec?: number
  seekForwardSec?: number
}

/** Find the track index covering a global position (clamps to last track). */
function trackIndexForPosition(tracks: AbsTrack[], pos: number): number {
  for (let i = tracks.length - 1; i >= 0; i--) {
    if (pos >= tracks[i].startOffsetSec) return i
  }
  return 0
}

export function useAudioPlayer({
  tracks,
  totalDurationSec,
  startAtSec,
  autoplayOnLoad = false,
  onSaveProgress,
  onBookEnded,
  seekBackwardSec = 15,
  seekForwardSec = 30,
}: UsePlayerArgs) {
  // Latest onBookEnded, read by the [tracks] effect without re-subscribing.
  const onBookEndedRef = useRef(onBookEnded)
  onBookEndedRef.current = onBookEnded
  const audioRef = useRef<HTMLAudioElement | null>(null)
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

  // Lazily create the single audio element.
  if (!audioRef.current && typeof Audio !== 'undefined') {
    audioRef.current = new Audio()
    audioRef.current.preload = 'metadata'
  }

  // Apply playback rate to the element whenever it changes.
  const setRate = useCallback((r: number) => {
    setRateState(r)
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

  // Load a given track and seek to a local offset, optionally autoplaying.
  const loadTrack = useCallback(
    (index: number, localOffsetSec: number, autoplay: boolean) => {
      const audio = audioRef.current
      const track = tracks[index]
      if (!audio || !track || !track.url) return
      currentTrackRef.current = index
      // Block position tracking until the seek below lands (load fires timeupdate
      // at currentTime=0 first; recording that would clobber the resume point).
      seekedRef.current = false
      audio.src = track.url
      const onMeta = () => {
        audio.currentTime = Math.max(0, Math.min(localOffsetSec, audio.duration || localOffsetSec))
        audio.playbackRate = rate
        audio.volume = volumeRef.current
        seekedRef.current = true
        if (autoplay) void audio.play().catch(() => setPlaying(false))
        audio.removeEventListener('loadedmetadata', onMeta)
      }
      audio.addEventListener('loadedmetadata', onMeta)
      audio.load()
    },
    [tracks, rate],
  )

  // Seek to a global book position.
  const seekTo = useCallback(
    (globalSec: number) => {
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

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play().catch(() => setPlaying(false))
    else audio.pause()
  }, [])

  const skip = useCallback(
    (deltaSec: number) => seekTo(positionSec + deltaSec),
    [positionSec, seekTo],
  )

  // Wire audio element events. Re-run when track set changes.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || tracks.length === 0) return

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
        if (listened > 0 || moved) onSaveProgress(positionRef.current, listened)
      }
    }

    const onTime = () => {
      // Ignore the timeupdate(s) the browser fires at currentTime=0 while a track
      // is still loading - we haven't applied the resume seek yet, so this is not
      // a real position and must not be recorded or saved.
      if (!seekedRef.current) return
      const idx = currentTrackRef.current
      const base = tracks[idx]?.startOffsetSec ?? 0
      const global = base + audio.currentTime
      // A small forward step at ~playback rate is real listening; a large jump
      // is a seek/track-swap and contributes no listened-time.
      const step = global - prevPosRef.current
      if (step > 0 && step < 10) listenedRef.current += step
      prevPosRef.current = global
      positionRef.current = global
      setPositionSec(global)
      save()
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => {
      setPlaying(false)
      save(true)
    }
    const onEnded = () => {
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
    const onCanPlay = () => setReady(true)

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('canplay', onCanPlay)

    // Reset the saved-position baseline to THIS book's resume point before the
    // initial load, so a stale prior-book position can't leak into a save.
    positionRef.current = startAtSec
    prevPosRef.current = startAtSec
    setPositionSec(startAtSec)
    // Initial load at the saved position; autoplay if the caller requested it.
    const idx = trackIndexForPosition(tracks, startAtSec)
    loadTrack(idx, startAtSec - tracks[idx].startOffsetSec, autoplayRef.current)

    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('canplay', onCanPlay)
      audio.pause()
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
    setHandler('play', () => audioRef.current?.play())
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
  }, [playing, skip, seekTo, seekBackwardSec, seekForwardSec])

  // Keep the OS/car transport widget's own progress bar in sync with real
  // position + duration + rate, so it can render a live scrubber and drag-seek
  // (not just skip buttons) - Tesla's browser media widget shows this.
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
