import { useServerStatus } from '@/hooks/useServers'
import { cn } from '@/lib/cn'

const DOT: Record<string, string> = {
  online: 'bg-primary',
  offline: 'bg-destructive',
  unknown: 'bg-muted-foreground',
  unreachable: 'bg-destructive',
}

const LABEL: Record<string, string> = {
  online: 'Online',
  offline: 'Offline',
  unknown: 'Checking...',
  unreachable: 'Not reachable',
}

/**
 * Live status dot for one server, probed via the control plane. While the probe
 * is in flight it reads "Checking..."; an unreachable stored URL (bad scheme /
 * bare IP) reads "Not reachable" so the user understands it can never be opened
 * until they publish it at a real HTTPS address.
 */
export function ServerStatusDot({ serverId }: { serverId: string }) {
  const { data, isLoading, isError } = useServerStatus(serverId)

  let state: keyof typeof DOT = 'unknown'
  if (!isLoading) {
    if (isError) state = 'offline'
    else if (data && data.reachable === false) state = 'unreachable'
    else if (data) state = data.status
  }

  return (
    <span className="flex items-center gap-2">
      <span className={cn('size-2 rounded-full', DOT[state], isLoading && 'animate-pulse')} />
      <span className="t-muted text-[13px]">{LABEL[state]}</span>
    </span>
  )
}
