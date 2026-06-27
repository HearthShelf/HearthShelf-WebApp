import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Server, MoreVertical, ExternalLink, Trash2 } from 'lucide-react'
import { useUnlinkServer } from '@/hooks/useServers'
import { ServerStatusDot } from '@/components/ServerStatusDot'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/cn'
import type { LinkedServer } from '@/types/server'

/**
 * One row on the "Pick a library" screen. Clicking the row opens the server; a
 * kebab menu (revealed on hover/focus) and a right-click context menu both offer
 * Open and Remove. Remove unlinks the server from the user's account after a
 * confirm - it does not touch the server itself.
 */
export function ServerRow({ server }: { server: LinkedServer }) {
  const navigate = useNavigate()
  const unlink = useUnlinkServer()
  const [menu, setMenu] = useState<{ x: number; y: number; align: 'left' | 'right' } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const to = `/server/${server.id}`

  function openMenuFromKebab(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({ x: r.right, y: r.bottom + 4, align: 'right' })
  }

  function openMenuFromContext(e: React.MouseEvent) {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, align: 'left' })
  }

  function open() {
    setMenu(null)
    navigate(to)
  }

  function remove() {
    unlink.mutate(server.id, {
      onSuccess: () => {
        notify.success(`Removed ${server.name}`)
        setConfirmRemove(false)
      },
      onError: (err) =>
        notify.error(notify.fromError(err, `Could not remove ${server.name}`)),
    })
  }

  return (
    <li>
      <div className="group relative" onContextMenu={openMenuFromContext}>
        <Link
          to={to}
          className={cn(
            'flex items-center gap-4 rounded-lg border border-border bg-card p-4',
            'transition-colors hover:bg-elevated'
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <Server size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-card-foreground">{server.name}</span>
            <span className="t-mono block truncate">{server.url}</span>
          </span>
          <ServerStatusDot serverId={server.id} />
          {/* Spacer so the status dot never sits under the kebab button. */}
          <span className="w-7" aria-hidden />
        </Link>

        <button
          type="button"
          aria-label={`Actions for ${server.name}`}
          onClick={openMenuFromKebab}
          className={cn(
            'absolute right-3 top-1/2 -translate-y-1/2 flex size-7 items-center justify-center',
            'rounded-md text-muted-foreground transition',
            'hover:bg-accent hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            // Hidden until hover/focus on pointer devices; always shown on touch.
            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            'max-[640px]:opacity-100'
          )}
        >
          <MoreVertical size={18} />
        </button>
      </div>

      {menu && (
        <Menu x={menu.x} y={menu.y} align={menu.align} onClose={() => setMenu(null)}>
          <MenuItem icon={<ExternalLink size={16} />} onSelect={open}>
            Open
          </MenuItem>
          <MenuItem
            icon={<Trash2 size={16} />}
            destructive
            onSelect={() => {
              setMenu(null)
              setConfirmRemove(true)
            }}
          >
            Remove
          </MenuItem>
        </Menu>
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Remove server?"
          message={
            <>
              <span className="font-medium text-card-foreground">{server.name}</span> will be
              unlinked from your account. The server itself and its library stay untouched - you
              can link it again later with a new pairing code.
            </>
          }
          confirmLabel="Remove"
          busy={unlink.isPending}
          onConfirm={remove}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </li>
  )
}
