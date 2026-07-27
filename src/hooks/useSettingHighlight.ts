import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// Settings search navigates with { state: { highlight: <row title> } }. Rows ask
// this hook whether they're the one that was picked, then flash for a moment and
// scroll into view so the eye lands on the right control in a long section.
//
// The state is cleared right after it's read, so a refresh or a back-navigation
// doesn't re-flash a row the user has already found.
const FLASH_MS = 1600

export function useSettingHighlight(title: string | undefined) {
  const location = useLocation()
  const navigate = useNavigate()
  const wanted = (location.state as { highlight?: string } | null)?.highlight
  const isTarget = Boolean(title) && wanted === title
  const [on, setOn] = useState(false)
  // Clearing the location state below flips isTarget back to false on the very
  // next render, so the flash timer must not hang off that effect's cleanup - it
  // would be cancelled immediately and leave the row lit forever. Latch here and
  // let the timer be the only thing that turns the flash off.
  const armed = useRef(false)
  const nodeRef = useRef<HTMLDivElement | null>(null)

  // A stable ref callback: an inline closure would be a new function every
  // render, so React would detach and reattach the ref on each pass.
  const ref = useCallback((el: HTMLDivElement | null) => {
    nodeRef.current = el
  }, [])

  useEffect(() => {
    if (!isTarget || armed.current) return
    armed.current = true
    setOn(true)
    nodeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    navigate(location.pathname, { replace: true, state: null })
    // Runs once per arrival; navigate/location are stable enough for this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTarget])

  useEffect(() => {
    if (!on) return
    const t = setTimeout(() => {
      setOn(false)
      armed.current = false
    }, FLASH_MS)
    return () => clearTimeout(t)
  }, [on])

  return { on, ref }
}
