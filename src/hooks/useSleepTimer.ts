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
 * Note: volume fade is a UI/preference-only stub here - the WebApp's
 * PlayerProvider does not expose the <audio> element's volume, so we pause
 * cleanly at the deadline (rewind still applies) rather than fading out.
 */
export function useSleepTimer(): SleepCtl {
  const { now, positionSec, playing, togglePlay, seekTo } = usePlayer()
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

  // The stop sequence: optional rewind, then pause.
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
  }, [s.sleepRewindSec, s.chapterBarrier, chapters, seekTo, pause])

  // Countdown tick for duration / time modes.
  useEffect(() => {
    if (!sleeping) return
    tickRef.current = window.setInterval(() => {
      setLeft((l) => {
        if (l <= 1) {
          fireStop()
          return 0
        }
        return l - 1
      })
    }, 1000)
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current)
    }
  }, [sleeping, fireStop])

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

  const endsAt = sleeping
    ? clockLabel(left)
    : eoc
      ? `ch ${eoc.idx + 1} ${eoc.at}`
      : ''

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
