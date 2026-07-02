import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, MoreVertical, ExternalLink, Trash2, Star } from 'lucide-react'
import { useUnlinkServer, useSetDefaultServer, useClearDefaultServer } from '@/hooks/useServers'
import { useActiveServerStore } from '@/store/activeServer'
import { ServerStatusDot } from '@/components/ServerStatusDot'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/cn'
import type { LinkedServer } from '@/types/server'

/**
 * One server in the account's "My servers" list. Clicking the row makes that
 * server active and opens its library; a kebab menu (hover/focus) and right-click
 * context menu both offer Open and Remove. Remove unlinks the server from the
 * user's account after a confirm - it does not touch the server itself.
 *
 * The row shows the server's NAME and a friendly status only - never the Direct
 * URL or a server id (those are ugly and confusing to non-technical users).
 */
export function ServerRow({ server, active }: { server: LinkedServer; active?: boolean }) {
  const navigate = useNavigate()
  const unlink = useUnlinkServer()
  const setDefault = useSetDefaultServer()
  const clearDefault = useClearDefaultServer()
  const setActiveServer = useActiveServerStore((s) => s.setActiveServer)
  const [menu, setMenu] = useState<{ x: number; y: number; align: 'left' | 'right' } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

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
    setActiveServer(server.id)
    navigate('/library')
  }

  function remove() {
    unlink.mutate(server.id, {
      onSuccess: () => {
        notify.success(`Removed ${server.name}`)
        setConfirmRemove(false)
      },
      onError: (err) => notify.error(notify.fromError(err, `Could not remove ${server.name}`)),
    })
  }

  // Toggle this server as the account default (the one a fresh device opens to).
  function toggleDefault() {
    setMenu(null)
    if (server.isDefault) {
      clearDefault.mutate(server.id, {
        onError: (err) => notify.error(notify.fromError(err, 'Could not update default')),
      })
    } else {
      setDefault.mutate(server.id, {
        onSuccess: () => notify.success(`${server.name} is now your default`),
        onError: (err) => notify.error(notify.fromError(err, 'Could not set default')),
      })
    }
  }

  return (
    <li>
      <div className="group relative" onContextMenu={openMenuFromContext}>
        <button
          type="button"
          onClick={open}
          className={cn(
            'flex w-full items-center gap-4 rounded-lg border bg-card p-4 text-left',
            'transition-colors hover:bg-elevated',
            active ? 'border-primary/60' : 'border-border',
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <Server size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 font-medium text-card-foreground">
              <span className="truncate">{server.name}</span>
              {server.isDefault && (
                <Star
                  size={13}
                  className="shrink-0 fill-primary text-primary"
                  aria-label="Default server"
                />
              )}
            </span>
            <span className="t-muted block truncate text-[12px]">
              {active
                ? 'Currently browsing'
                : server.isDefault
                  ? 'Your default library'
                  : 'Tap to open this library'}
            </span>
          </span>
          <ServerStatusDot serverId={server.id} />
          {/* Spacer so the status dot never sits under the kebab button. */}
          <span className="w-7" aria-hidden />
        </button>

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
            'max-[640px]:opacity-100',
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
          <MenuItem icon={<Star size={16} />} onSelect={toggleDefault}>
            {server.isDefault ? 'Remove as default' : 'Make default'}
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
              unlinked from your account. The server itself and its library stay untouched - you can
              link it again later with a new pairing code.
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
