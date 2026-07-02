/**
 * Club note-pop watcher: while the playing book is a club's CURRENT book, polls
 * that club's gated stubs and toasts (sonner) whenever playback crosses one -
 * the newly-unlocked note's author + body, click-through to the club room. A
 * scrub that crosses several at once condenses into one "Passed N notes" toast
 * instead of a flood. Ported from the self-hosted reference
 * (src/components/social/NotePopWatcher.tsx in HearthShelf) onto this repo's
 * idioms: usePlayer() (not a global player store), AbsTarget + in-memory ABS
 * tokens (absClubs.ts), and sonner toasts via lib/notify.
 *
 * Mounted once in AppShell, inside <PlayerProvider>, beside useSettingsSync.
 */
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { usePlayer } from '@/player/PlayerProvider'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useSettingsStore } from '@/store/settingsStore'
import { getClubs, getClubDetail } from '@/api/absClubs'
import { detectNotePops } from '@hearthshelf/core'
import type { AbsTarget } from '@/api/absLibrary'
import type { HSNote, HSNoteStub } from '@hearthshelf/core'

const SEEN_CAP = 500
const SEEN_PREFIX = 'hearthshelf:notePops:'
const POLL_MS = 30 * 1000

// Device-local pop dedupe: seen stub ids per club, capped, in localStorage.
function loadSeen(clubId: string): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_PREFIX + clubId)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function saveSeen(clubId: string, ids: string[]) {
  try {
    // Keep the most recent SEEN_CAP ids (ids are appended in crossing order).
    const capped = ids.slice(-SEEN_CAP)
    localStorage.setItem(SEEN_PREFIX + clubId, JSON.stringify(capped))
  } catch {
    // Storage full / disabled - re-pop after clear is accepted (v1).
  }
}

/** Toast a single unlocked note (author + body), click-through to the club room. */
function toastNote(note: HSNote, openClub: () => void) {
  toast(note.username ? `${note.username} left a note` : 'A note unlocked', {
    description: note.body,
    action: { label: 'Open', onClick: openClub },
    duration: 6000,
  })
}

/** Toast a condensed summary for a scrub that crossed several stubs at once. */
function toastPassed(count: number, openClub: () => void) {
  toast(`Passed ${count} ${count === 1 ? 'note' : 'notes'}`, {
    description: 'Tap to open the club chat',
    action: { label: 'Open', onClick: openClub },
    duration: 6000,
  })
}

/**
 * Watches the playing book's club stubs and toasts when playback crosses one,
 * deep-linking into /club/:clubId. Only the currently playing book's active
 * club (mine, whose current book is the playing item) is watched; the
 * notePops device setting silences it entirely.
 */
export function useNotePops() {
  const navigate = useNavigate()
  const { now, positionSec } = usePlayer()
  const { target } = useActiveServer()

  const libraryItemId = now?.itemId ?? null

  // The active club (mine, whose current book is the playing item) + its stubs.
  const clubRef = useRef<string | null>(null)
  const stubsRef = useRef<HSNoteStub[]>([])
  const seenRef = useRef<Set<string>>(new Set())
  const seenOrderRef = useRef<string[]>([])
  const lastPosRef = useRef(0)
  const targetRef = useRef<AbsTarget | null>(null)
  targetRef.current = target

  const openClub = (clubId: string) => navigate(`/club/${clubId}`)

  // Resolve which club (if any) governs the currently playing book, and load its
  // locked stubs. Re-runs whenever the playing item or server changes.
  useEffect(() => {
    let cancelled = false
    clubRef.current = null
    stubsRef.current = []
    lastPosRef.current = 0
    if (!target || !libraryItemId) return
    void (async () => {
      const clubs = await getClubs(target, libraryItemId)
      if (cancelled || !clubs.enabled) return
      const active = clubs.mine.find((c) => c.currentBook?.libraryItemId === libraryItemId)
      if (!active) return
      clubRef.current = active.id
      seenRef.current = loadSeen(active.id)
      seenOrderRef.current = [...seenRef.current]
      lastPosRef.current = positionSec
      const detail = await getClubDetail(target, active.id, { position: positionSec })
      if (cancelled || clubRef.current !== active.id) return
      stubsRef.current = detail.notes.locked
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.serverId, libraryItemId])

  // Refresh stubs on a 30s poll (piggybacking the same cadence progress already
  // syncs on) so newly added ahead-notes get ticks/pops without reopening the
  // book.
  useEffect(() => {
    if (!target || !libraryItemId) return
    const id = window.setInterval(() => {
      const t = targetRef.current
      const clubId = clubRef.current
      if (!t || !clubId) return
      void getClubDetail(t, clubId, { position: lastPosRef.current }).then((d) => {
        if (clubRef.current === clubId) stubsRef.current = d.notes.locked
      })
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [target?.serverId, libraryItemId])

  // Position-crossing detection: runs whenever positionSec advances. Cheap
  // (array filter over a handful of stubs) and only does real work - a network
  // fetch or a toast - on an actual crossing, never on the hot per-tick path.
  useEffect(() => {
    const clubId = clubRef.current
    const t = targetRef.current
    if (!clubId || !t) {
      lastPosRef.current = positionSec
      return
    }
    if (!useSettingsStore.getState().notePops) {
      lastPosRef.current = positionSec
      return
    }
    const prev = lastPosRef.current
    const next = positionSec
    if (next === prev) return
    const { pops, seeked } = detectNotePops(prev, next, stubsRef.current, seenRef.current)
    lastPosRef.current = next
    if (pops.length === 0) return

    // Mark all crossed stubs seen (dedupe), persist capped.
    for (const p of pops) {
      if (!seenRef.current.has(p.id)) {
        seenRef.current.add(p.id)
        seenOrderRef.current.push(p.id)
      }
    }
    saveSeen(clubId, seenOrderRef.current)

    if (seeked) {
      // A scrub crossed several at once - one summary toast, no flood.
      toastPassed(pops.length, () => openClub(clubId))
      return
    }
    // A single natural crossing: fetch the now-unlocked note and toast it.
    void getClubDetail(t, clubId, { position: next }).then((detail) => {
      const note = detail.notes.notes.find((n) => pops.some((p) => p.id === n.id))
      if (note) toastNote(note, () => openClub(clubId))
      else toastPassed(pops.length, () => openClub(clubId))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionSec])
}
