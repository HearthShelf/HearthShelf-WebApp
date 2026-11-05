import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from '@/components/common/Icon'
import { NavPopover } from '@/components/layout/NavPopover'
import type { NavMoreGroup } from '@/components/layout/navMenu'

interface Props {
  groups: NavMoreGroup[]
  activeGroup: string
  collapsed: boolean
  onShow: (id: string) => void
  onShowAll: () => void
}

// Holds whatever the user hid from the left menu: still one click away, and each
// row can go back to the menu from here.
export function NavMoreMenu({ groups, activeGroup, collapsed, onShow, onShowAll }: Props) {
  const { pathname } = useLocation()
  const button = useRef<HTMLButtonElement>(null)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const close = useCallback(() => setAt(null), [])
  const active = groups.some((g) => g.items.some((i) => i.group === activeGroup))

  useEffect(close, [pathname, close])

  const toggle = () => {
    if (at) return close()
    const row = button.current
    if (!row) return
    const sidebar = row.closest('.sidebar') ?? row
    setAt({ x: sidebar.getBoundingClientRect().right + 8, y: row.getBoundingClientRect().top })
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className={'nav-item' + (active || at ? ' active' : '')}
        onClick={toggle}
        title={collapsed ? 'More' : undefined}
        aria-label="More"
        aria-haspopup="dialog"
        aria-expanded={Boolean(at)}
      >
        <Icon name="more_horiz" fill={active} />
        <span className="ni-label">More</span>
      </button>
      {at && (
        <NavPopover
          x={at.x}
          y={at.y}
          role="dialog"
          label="More menu items"
          onClose={close}
          anchorRef={button}
        >
          {groups.map((group) => (
            <div key={group.key}>
              {group.label && (
                <div className="nav-more-head">
                  <span>{group.label}</span>
                  {group.sectionId && (
                    <button
                      type="button"
                      className="nav-more-show"
                      onClick={() => onShow(group.sectionId!)}
                      title={`Show ${group.label} section in the menu`}
                      aria-label={`Show ${group.label} section in the menu`}
                    >
                      <Icon name="visibility" />
                    </button>
                  )}
                </div>
              )}
              {group.items.map((item) => (
                <div key={item.id} className="nav-more-row">
                  <Link
                    to={item.to}
                    className={'mp-item' + (item.group === activeGroup ? ' on' : '')}
                    onClick={close}
                  >
                    <Icon name={item.icon} /> {item.label}
                  </Link>
                  {!group.sectionId && (
                    <button
                      type="button"
                      className="nav-more-show"
                      onClick={() => onShow(item.id)}
                      title={`Show ${item.label} in the menu`}
                      aria-label={`Show ${item.label} in the menu`}
                    >
                      <Icon name="visibility" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
          <div className="ctx-divider" />
          <button type="button" className="mp-item" onClick={onShowAll}>
            <Icon name="visibility" /> Show everything
          </button>
        </NavPopover>
      )}
    </>
  )
}
