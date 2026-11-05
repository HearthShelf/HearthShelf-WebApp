import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

const EDGE = 8
const FOCUSABLE = 'a[href], button:not([disabled])'

interface Props {
  x: number
  y: number
  label: string
  role: 'menu' | 'dialog'
  onClose: () => void
  // The control that opened this. Pressing it must toggle, not close and reopen.
  anchorRef?: RefObject<HTMLElement | null>
  children: ReactNode
}

// A small floating panel for the left menu: stays on screen, closes on click-away
// or Escape, and hands keyboard focus back when it goes.
export function NavPopover({ x, y, label, role, onClose, anchorRef, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    if (!ref.current) return
    // offset sizes, not getBoundingClientRect: the pop-in animation starts scaled down.
    const { offsetWidth: width, offsetHeight: height } = ref.current
    setPos({
      x: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
      y: Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)),
    })
  }, [x, y])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true })
    return () => previous?.focus?.({ preventScroll: true })
  }, [])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || anchorRef?.current?.contains(target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      if (!items.length) return
      e.preventDefault()
      const at = items.indexOf(document.activeElement as HTMLElement)
      const step = e.key === 'ArrowDown' ? 1 : -1
      items[(at + step + items.length) % items.length].focus()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose, anchorRef])

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu nav-popover"
      role={role}
      aria-label={label}
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  )
}
