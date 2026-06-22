import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Server } from 'lucide-react'
import { useServerStore } from '@/store/servers'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

const STATUS_DOT: Record<string, string> = {
  online: 'bg-primary',
  offline: 'bg-destructive',
  unknown: 'bg-muted-foreground',
}

export function ServerPickerPage() {
  const { servers, loadServers } = useServerStore()

  useEffect(() => {
    loadServers()
  }, [loadServers])

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <p className="t-eyebrow">Your servers</p>
        <h1 className="t-h1 mt-1">Pick a library</h1>
        <p className="t-muted mt-2">
          Every HearthShelf server you have access to, in one place.
        </p>
      </div>

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

      <div className="mt-6">
        {/* TODO(pairing): launch the pairing-code link flow (ARCHITECTURE.md). */}
        <Button variant="secondary">
          <Plus size={16} />
          Link a server
        </Button>
      </div>
    </div>
  )
}
