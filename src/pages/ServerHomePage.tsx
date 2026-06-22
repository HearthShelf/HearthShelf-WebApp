import { useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useServerStore } from '@/store/servers'

export function ServerHomePage() {
  const { serverId } = useParams()
  const server = useServerStore((s) => s.servers.find((x) => x.id === serverId))

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/" className="t-muted mb-6 inline-flex items-center gap-1.5 text-[13px] hover:text-foreground">
        <ArrowLeft size={14} />
        All servers
      </Link>

      <p className="t-eyebrow">Connected to</p>
      <h1 className="t-h1 mt-1">{server?.name ?? 'Unknown server'}</h1>
      <p className="t-mono mt-2">{server?.url ?? serverId}</p>

      <div className="mt-8 rounded-xl border border-border bg-card p-8">
        <p className="t-body">
          Library, player, and Discover surfaces mount here once the per-server
          connection is live. This view will talk to the HearthShelf gateway
          directly over its public HTTP and Socket APIs.
        </p>
        {/* TODO(connection): redeem the control-plane grant for a per-server
            token, then open the direct HTTP + Socket.io connection. */}
      </div>
    </div>
  )
}
