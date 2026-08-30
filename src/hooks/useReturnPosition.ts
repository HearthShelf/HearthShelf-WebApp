import { useCallback, useRef, useState } from 'react'

/** A backwards seek smaller than this is a nudge, not a jump - no offer to go back. */
const RETURN_JUMP_MIN_SEC = 60
/** How close counts as "caught back up", absorbing seek settling slop. */
const SETTLE_TOLERANCE_SEC = 2

/**
 * Tracks the furthest spot playback had reached before a large backwards seek,
 * so the player can offer to jump back to it.
 *
 * Mirrors the mobile app's return-position rule (see HearthShelf-Mobile
 * src/player/store.ts): a backwards seek of a minute or more remembers where
 * you were; the offer clears itself once you listen back past that spot, and
 * can be thrown away by hand. Dismissal matters because the furthest point
 * isn't always worth returning to - falling asleep with no sleep timer leaves
 * it hours past anything actually heard.
 */
export function useReturnPosition() {
  const [returnPosition, setReturnPosition] = useState<number | null>(null)
  // Read inside the seek callback without making it a dependency, so the
  // wrapped seek stays referentially stable for the components below it.
  const ref = useRef<number | null>(null)
  ref.current = returnPosition

  /** Call with (positionBeforeSeek, seekTarget) on every seek. */
  const noteSeek = useCallback((from: number, to: number) => {
    if (from - to >= RETURN_JUMP_MIN_SEC) {
      // Keep the furthest of the two: seeking back twice shouldn't move the
      // return target closer to where you now are.
      setReturnPosition((current) => Math.max(current ?? 0, from))
      return
    }
    // Seeking forward to (or past) the remembered spot means it's been reached
    // by hand; nothing left to offer.
    if (ref.current !== null && to >= ref.current - SETTLE_TOLERANCE_SEC) setReturnPosition(null)
  }, [])

  /** Call as playback advances, so the offer clears once listening catches up. */
  const notePosition = useCallback((position: number) => {
    if (ref.current !== null && position >= ref.current - SETTLE_TOLERANCE_SEC)
      setReturnPosition(null)
  }, [])

  const dismiss = useCallback(() => setReturnPosition(null), [])

  return { returnPosition, noteSeek, notePosition, dismiss }
}
