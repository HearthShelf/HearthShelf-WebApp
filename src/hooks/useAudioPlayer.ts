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
  /** Called (throttled) to persist the current global position. */
  onSaveProgress: (currentTimeSec: number) => void
  /** Called when the LAST track of the book finishes (for queue auto-advance). */
  onBookEnded?: () => void
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
      audio.src = track.url
      const onMeta = () => {
        audio.currentTime = Math.max(0, Math.min(localOffsetSec, audio.duration || localOffsetSec))
        audio.playbackRate = rate
        audio.volume = volumeRef.current
        if (autoplay) void audio.play().catch(() => setPlaying(false))
        audio.removeEventListener('loadedmetadata', onMeta)
      }
      audio.addEventListener('loadedmetadata', onMeta)
      audio.load()
    },
    [tracks, rate]
  )

  // Seek to a global book position.
  const seekTo = useCallback(
    (globalSec: number) => {
      const pos = Math.max(0, Math.min(globalSec, totalDurationSec))
      const idx = trackIndexForPosition(tracks, pos)
      const local = pos - tracks[idx].startOffsetSec
      setPositionSec(pos)
      if (idx !== currentTrackRef.current) {
        loadTrack(idx, local, playing)
      } else if (audioRef.current) {
        audioRef.current.currentTime = local
      }
    },
    [tracks, totalDurationSec, playing, loadTrack]
  )

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play().catch(() => setPlaying(false))
    else audio.pause()
  }, [])

  const skip = useCallback(
    (deltaSec: number) => seekTo(positionSec + deltaSec),
    [positionSec, seekTo]
  )

  // Wire audio element events. Re-run when track set changes.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || tracks.length === 0) return

    const save = (force = false) => {
      const now = Date.now()
      if (force || now - lastSaveRef.current > 10_000) {
        lastSaveRef.current = now
        onSaveProgress(positionRef.current)
      }
    }
    // Track position in a ref so the interval/handlers see the latest value.
    const positionRef = { current: startAtSec }

    const onTime = () => {
      const idx = currentTrackRef.current
      const base = tracks[idx]?.startOffsetSec ?? 0
      const global = base + audio.currentTime
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

  // Media Session: lock-screen / media-key controls and metadata.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    ms.setActionHandler('play', () => audioRef.current?.play())
    ms.setActionHandler('pause', () => audioRef.current?.pause())
    ms.setActionHandler('seekbackward', () => skip(-15))
    ms.setActionHandler('seekforward', () => skip(15))
    ms.playbackState = playing ? 'playing' : 'paused'
    return () => {
      ms.setActionHandler('play', null)
      ms.setActionHandler('pause', null)
      ms.setActionHandler('seekbackward', null)
      ms.setActionHandler('seekforward', null)
    }
  }, [playing, skip])

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
