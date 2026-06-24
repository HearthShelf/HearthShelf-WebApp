import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react'
import { useServer } from '@/hooks/useServers'
import { useAuthor } from '@/hooks/useLibrary'
import { hasAbsToken } from '@/lib/absTokens'
import { type AbsTarget } from '@/api/absLibrary'
import { WebAppMediaUIProvider } from '@/components/shared/WebAppMediaUI'
import { ItemGrid } from '@/components/ItemGrid'

/** Author detail: name, description, and a grid of their books. */
export function AuthorDetailPage() {
  const { serverId, authorId } = useParams()
  const server = useServer(serverId)
  const target: AbsTarget | null = serverId && server ? { serverId, serverUrl: server.url } : null
  const connected = serverId ? hasAbsToken(serverId) : false
  const { data, isLoading, isError } = useAuthor(target as AbsTarget, authorId, Boolean(target) && connected)

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to={serverId ? `/server/${serverId}` : '/'}
        className="t-muted mb-6 inline-flex items-center gap-1.5 text-[13px] hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Back to library
      </Link>

      {(!connected || isLoading) && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-muted-foreground">
          <Loader2 className="animate-spin" size={18} />
          <span className="t-body">Loading...</span>
        </div>
      )}

      {connected && isError && (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-6">
          <AlertCircle className="mt-0.5 shrink-0 text-destructive" size={18} />
          <p className="t-body text-card-foreground">Couldn't load this author.</p>
        </div>
      )}

      {connected && data && target && (
        <WebAppMediaUIProvider target={target}>
          <p className="t-eyebrow">Author</p>
          <h1 className="t-h1 mt-1">{data.name}</h1>
          {data.description && (
            <p className="t-body mt-3 max-w-2xl whitespace-pre-line text-muted-foreground">
              {data.description}
            </p>
          )}
          <h2 className="t-h2 mb-3 mt-8">Books</h2>
          {data.items.length > 0 ? (
            <ItemGrid items={data.items} />
          ) : (
            <p className="t-muted text-[13px]">No books found for this author.</p>
          )}
        </WebAppMediaUIProvider>
      )}
    </div>
  )
}
