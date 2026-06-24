import { useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useServer } from '@/hooks/useServers'
import { InvitePanel } from '@/components/InvitePanel'
import { ServerLibrary } from '@/components/ServerLibrary'

export function ServerHomePage() {
  const { serverId } = useParams()
  const server = useServer(serverId)

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/" className="t-muted mb-6 inline-flex items-center gap-1.5 text-[13px] hover:text-foreground">
        <ArrowLeft size={14} />
        All servers
      </Link>

      <p className="t-eyebrow">Connected to</p>
      <h1 className="t-h1 mt-1">{server?.name ?? 'Unknown server'}</h1>
      <p className="t-mono mt-2">{server?.url ?? serverId}</p>

      <div className="mt-8">
        {serverId && server ? (
          <ServerLibrary target={{ serverId, serverUrl: server.url }} />
        ) : (
          <div className="rounded-xl border border-border bg-card p-8">
            <p className="t-body text-muted-foreground">
              This server isn't in your list. Go back and pick one of your linked
              servers.
            </p>
          </div>
        )}
      </div>

      {/* Invites are admin-only; the control plane enforces this too (403). */}
      {server?.role === 'admin' && serverId && (
        <div className="mt-6">
          <InvitePanel serverId={serverId} />
        </div>
      )}
    </div>
  )
}
