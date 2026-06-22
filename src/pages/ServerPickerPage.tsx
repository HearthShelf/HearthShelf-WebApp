import { Link } from 'react-router-dom'
import { Plus, Server, AlertCircle, Loader2 } from 'lucide-react'
import { useServers } from '@/hooks/useServers'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

const STATUS_DOT: Record<string, string> = {
  online: 'bg-primary',
  offline: 'bg-destructive',
  unknown: 'bg-muted-foreground',
}

export function ServerPickerPage() {
  const { data: servers, isLoading, isError, error } = useServers()

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <p className="t-eyebrow">Your servers</p>
        <h1 className="t-h1 mt-1">Pick a library</h1>
        <p className="t-muted mt-2">
          Every HearthShelf server you have access to, in one place.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-muted-foreground">
          <Loader2 className="animate-spin" size={18} />
          <span className="t-body">Loading your servers...</span>
        </div>
      )}

      {isError && (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-6">
          <AlertCircle className="mt-0.5 shrink-0 text-destructive" size={18} />
          <div>
            <p className="font-medium text-card-foreground">Couldn't load your servers</p>
            <p className="t-muted mt-1 text-[13px]">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
        </div>
      )}

      {servers && servers.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <Server className="mx-auto text-muted-foreground" size={28} />
          <p className="mt-3 font-medium text-card-foreground">No servers linked yet</p>
          <p className="t-muted mx-auto mt-1 max-w-sm text-[13px]">
            Link your HearthShelf server with the pairing code shown in its setup
            to reach your library from here.
          </p>
        </div>
      )}

      {servers && servers.length > 0 && (
        <ul className="grid gap-3">
          {servers.map((s) => (
            <li key={s.id}>
              <Link
                to={`/server/${s.id}`}
                className={cn(
                  'flex items-center gap-4 rounded-lg border border-border bg-card p-4',
                  'transition-colors hover:bg-elevated'
                )}
              >
                <span className="flex size-10 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                  <Server size={18} />
                </span>
                <span className="flex-1">
                  <span className="block font-medium text-card-foreground">{s.name}</span>
                  <span className="t-mono block">{s.url}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={cn('size-2 rounded-full', STATUS_DOT[s.status])} />
                  <span className="t-muted text-[13px] capitalize">{s.status}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        {/* TODO(pairing): launch the pairing-code link flow -> useLinkServer(). */}
        <Button variant="secondary">
          <Plus size={16} />
          Link a server
        </Button>
      </div>
    </div>
  )
}
