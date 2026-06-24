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
  /** Called (throttled) to persist the current global position. */
  onSaveProgress: (currentTimeSec: number) => void
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
  onSaveProgress,
}: UsePlayerArgs) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [positionSec, setPositionSec] = useState(startAtSec)
  const [ready, setReady] = useState(false)
  const currentTrackRef = useRef<number>(-1)
  const lastSaveRef = useRef<number>(0)

  // Lazily create the single audio element.
  if (!audioRef.current && typeof Audio !== 'undefined') {
    audioRef.current = new Audio()
    audioRef.current.preload = 'metadata'
  }

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
        if (autoplay) void audio.play().catch(() => setPlaying(false))
        audio.removeEventListener('loadedmetadata', onMeta)
      }
      audio.addEventListener('loadedmetadata', onMeta)
      audio.load()
    },
    [tracks]
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
      // Advance to the next track, or stop at the end of the book.
      const next = currentTrackRef.current + 1
      if (next < tracks.length) {
        loadTrack(next, 0, true)
      } else {
        setPlaying(false)
        save(true)
      }
    }
    const onCanPlay = () => setReady(true)

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('canplay', onCanPlay)

    // Initial load at the saved position.
    const idx = trackIndexForPosition(tracks, startAtSec)
    loadTrack(idx, startAtSec - tracks[idx].startOffsetSec, false)

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

  return { playing, positionSec, ready, togglePlay, seekTo, skip }
}
