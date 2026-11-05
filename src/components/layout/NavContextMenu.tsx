import { Icon } from '@/components/common/Icon'
import { NavPopover } from '@/components/layout/NavPopover'
import type { NavMenuTarget } from '@/components/layout/navMenu'

interface Props {
  x: number
  y: number
  target: NavMenuTarget
  hasHidden: boolean
  onHide: (id: string) => void
  onShowAll: () => void
  onClose: () => void
}

// The right-click / press-and-hold menu for a row or section label in the left menu.
export function NavContextMenu({ x, y, target, hasHidden, onHide, onShowAll, onClose }: Props) {
  const { entry, section, pinned } = target
  const run = (fn: () => void) => () => {
    onClose()
    fn()
  }
  const canHideEntry = entry && !pinned

  return (
    <NavPopover
      x={x}
      y={y}
      role="menu"
      label={`${entry?.label ?? section?.label ?? 'Menu'} options`}
      onClose={onClose}
    >
      {entry && (
        <button
          className="mp-item"
          role="menuitem"
          onClick={run(() => window.open(entry.to, '_blank', 'noopener'))}
        >
          <Icon name="open_in_new" /> Open in new tab
        </button>
      )}
      {entry && (canHideEntry || section) && <div className="ctx-divider" />}
      {canHideEntry && (
        <button className="mp-item" role="menuitem" onClick={run(() => onHide(entry.id))}>
          <Icon name="visibility_off" /> Hide {entry.label}
        </button>
      )}
      {section && (
        <button className="mp-item" role="menuitem" onClick={run(() => onHide(section.id))}>
          <Icon name="visibility_off" /> Hide {section.label} section
        </button>
      )}
      {hasHidden && (
        <>
          <div className="ctx-divider" />
          <button className="mp-item" role="menuitem" onClick={run(onShowAll)}>
            <Icon name="visibility" /> Show everything
          </button>
        </>
      )}
    </NavPopover>
  )
}
