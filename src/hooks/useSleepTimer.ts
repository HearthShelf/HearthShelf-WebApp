import { useState, useEffect, useRef, useCallback } from 'react'
import { usePlayer } from '@/player/PlayerProvider'
import { useSettingsStore } from '@/store/settingsStore'

export type SleepTab = 'duration' | 'chapter' | 'time'
type StopAt = 'start' | 'end'

interface ChapterBound {
  id: number
  start: number
  end: number
  title: string
}

export interface SleepCtl {
  tab: SleepTab
  setTab: (t: SleepTab) => void
  // active = a stop point is armed (duration countdown, chapter, or clock)
  active: boolean
  sleeping: boolean // a live countdown is running (duration/time)
  left: number // seconds remaining on a countdown
  endsAt: string // human label for the stop point
  curIdx: number
  bounds: ChapterBound[]
  // chapter mode
  eoc: { idx: number; at: StopAt } | null
  setDuration: (mins: number) => void
  setChapter: (idx: number, at: StopAt) => void
  setClock: (hhmm: string) => void
  addTime: (mins: number) => void
  cancel: () => void
  // stop-behavior settings (mirrored to the settings store)
  rewindSec: number
  setRewindSec: (v: number) => void
  maxRewind: number
  chapterBarrier: boolean
  setBarrier: (v: boolean) => void
  fade: boolean
  setFade: (v: boolean) => void
  fadeLen: number
  setFadeLen: (v: number) => void
}

function clockLabel(addSeconds: number): string {
  const d = new Date(Date.now() + addSeconds * 1000)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * The client-only sleep timer. Drives three stop modes (duration / end-of-chapter
 * / clock time) plus a rewind-on-stop behaviour, on top of the global player
 * (usePlayer). Defaults for the stop behaviours come from the settings store.
 *
 * When fade is on, the last `fadeLen` seconds of a duration/clock countdown ramp
 * the player volume down to silence before the stop fires; volume is restored to
 * full once playback stops or the timer is cancelled.
 */
export function useSleepTimer(): SleepCtl {
  const { now, positionSec, playing, togglePlay, seekTo, setVolume } = usePlayer()
  const chapters: ChapterBound[] = (now?.chapters ?? []).map((c) => ({
    id: c.id,
    start: c.startSec,
    end: c.endSec,
    title: c.title,
  }))

  const s = useSettingsStore()
  const set = s.set

  const [tab, setTab] = useState<SleepTab>('duration')
  const [left, setLeft] = useState(0)
  const [eoc, setEoc] = useState<{ idx: number; at: StopAt } | null>(null)
  const tickRef = useRef<number | null>(null)

  const sleeping = left > 0
  const active = sleeping || eoc !== null

  // Latest position/play state for the deadline handler without re-arming the tick.
  const posRef = useRef(positionSec)
  posRef.current = positionSec
  const playingRef = useRef(playing)
  playingRef.current = playing

  let curIdx = chapters.findIndex((c) => positionSec < c.end)
  if (curIdx === -1) curIdx = Math.max(0, chapters.length - 1)

  const pause = useCallback(() => {
    if (playingRef.current) togglePlay()
  }, [togglePlay])

  // The stop sequence: optional rewind, then pause, then restore full volume (so
  // the next play isn't faded down from a previous sleep).
  const fireStop = useCallback(() => {
    if (s.sleepRewindSec > 0) {
      const cur = posRef.current
      const back = Math.max(0, cur - s.sleepRewindSec)
      if (s.chapterBarrier) {
        const ch = chapters.find((c) => cur < c.end)
        seekTo(ch ? Math.max(ch.start, back) : back)
      } else {
        seekTo(back)
      }
    }
    pause()
    setVolume(1)
  }, [s.sleepRewindSec, s.chapterBarrier, chapters, seekTo, pause, setVolume])

  // Countdown tick for duration / time modes. When fade is on, the last
  // `fadeLen` seconds ramp the volume down to silence before the stop fires.
  useEffect(() => {
    if (!sleeping) return
    tickRef.current = window.setInterval(() => {
      setLeft((l) => {
        const next = l - 1
        if (s.sleepFade && s.sleepFadeLen > 0) {
          setVolume(next >= s.sleepFadeLen ? 1 : Math.max(0, next / s.sleepFadeLen))
        }
        if (l <= 1) {
          fireStop()
          return 0
        }
        return next
      })
    }, 1000)
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current)
    }
  }, [sleeping, fireStop, s.sleepFade, s.sleepFadeLen, setVolume])

  // Chapter-mode stop: watch position and stop when we cross the target.
  useEffect(() => {
    if (!eoc) return
    const target = chapters[eoc.idx]
    if (!target) return
    const stopAt = eoc.at === 'start' ? target.start : target.end
    if (positionSec >= stopAt) {
      setEoc(null)
      fireStop()
    }
  }, [eoc, positionSec, chapters, fireStop])

  const endsAt = sleeping ? clockLabel(left) : eoc ? `ch ${eoc.idx + 1} ${eoc.at}` : ''

  return {
    tab,
    setTab,
    active,
    sleeping,
    left,
    endsAt,
    curIdx,
    bounds: chapters,
    eoc,
    setDuration: (mins) => {
      setEoc(null)
      setLeft(mins * 60)
    },
    setChapter: (idx, at) => {
      setLeft(0)
      setEoc({ idx, at })
    },
    setClock: (hhmm) => {
      if (!hhmm) return
      const [h, m] = hhmm.split(':').map(Number)
      const nowD = new Date()
      const target = new Date()
      target.setHours(h, m, 0, 0)
      if (target.getTime() <= nowD.getTime()) target.setDate(target.getDate() + 1)
      setEoc(null)
      setLeft(Math.round((target.getTime() - nowD.getTime()) / 1000))
    },
    addTime: (mins) => setLeft((l) => l + mins * 60),
    cancel: () => {
      setLeft(0)
      setEoc(null)
      setVolume(1)
    },
    rewindSec: s.sleepRewindSec,
    setRewindSec: (v) => set('sleepRewindSec', v),
    maxRewind: 300,
    chapterBarrier: s.chapterBarrier,
    setBarrier: (v) => set('chapterBarrier', v),
    fade: s.sleepFade,
    setFade: (v) => set('sleepFade', v),
    fadeLen: s.sleepFadeLen,
    setFadeLen: (v) => set('sleepFadeLen', v),
  }
}
