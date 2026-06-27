import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'

/**
 * Minimal floating menu: a positioned panel that closes on outside-click or
 * Escape. Position is supplied by the caller so the same primitive serves both a
 * kebab dropdown (anchored under a button) and a right-click context menu
 * (anchored at the cursor). Intentionally unstyled beyond the panel chrome -
 * compose with MenuItem for rows.
 */
export function Menu({
  x,
  y,
  align = 'left',
  onClose,
  children,
}: {
  /** Viewport-relative anchor point (px). */
  x: number
  y: number
  /** Which corner of the panel sits at (x, y). */
  align?: 'left' | 'right'
  onClose: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    // Pointerdown (capture) so a click anywhere - including another row - closes
    // before that click is handled.
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      className={cn(
        'fixed z-50 min-w-[10rem] overflow-hidden rounded-lg border border-border bg-card p-1 shadow-xl',
        align === 'right' && '-translate-x-full'
      )}
      style={{ left: x, top: y }}
    >
      {children}
    </div>
  )
}

export function MenuItem({
  icon,
  destructive = false,
  onSelect,
  children,
}: {
  icon?: React.ReactNode
  destructive?: boolean
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <button
      role="menuitem"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[14px]',
        'transition-colors',
        destructive
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-card-foreground hover:bg-accent'
      )}
    >
      {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
      <span className="flex-1">{children}</span>
    </button>
  )
}
