import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react'
import { useActiveServer } from '@/hooks/useActiveServer'
import { useAuthor } from '@/hooks/useLibrary'
import { ItemGrid } from '@/components/ItemGrid'

/**
 * Author detail: name, bio, and a grid of their books. Renders inside
 * <ActiveServerMediaUI>, so the active server is connected and the MediaUI
 * provider is mounted; we read the target from useActiveServer().
 */
export function AuthorDetailPage() {
  const { authorId } = useParams()
  const { target } = useActiveServer()
  const { data, isLoading, isError } = useAuthor(target!, authorId, Boolean(target))

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to="/library"
        className="t-muted mb-6 inline-flex items-center gap-1.5 text-[13px] hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Back to library
      </Link>

      {(!target || isLoading) && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-muted-foreground">
          <Loader2 className="animate-spin" size={18} />
          <span className="t-body">Loading...</span>
        </div>
      )}

      {target && isError && (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-6">
          <AlertCircle className="mt-0.5 shrink-0 text-destructive" size={18} />
          <p className="t-body text-card-foreground">Couldn't load this author.</p>
        </div>
      )}

      {target && data && (
        <>
          <p className="t-eyebrow">Author</p>
          <h1 className="t-h1 mt-1">{data.name}</h1>
          <p className="t-muted mt-1 text-[13px]">
            {data.items.length} {data.items.length === 1 ? 'book' : 'books'}
          </p>
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
        </>
      )}
    </div>
  )
}
