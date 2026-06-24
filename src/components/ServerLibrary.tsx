import { useState } from 'react'
import { Loader2, Link2, AlertCircle, BookOpen } from 'lucide-react'
import { useConnect, useLibraries, useLibraryItems } from '@/hooks/useLibrary'
import { itemCoverUrl, type AbsTarget } from '@/api/absLibrary'
import { Button } from '@/components/ui/Button'

/**
 * The library surface for one connected server. First it gates on connection
 * (the OIDC bounce, behind a user gesture). Once connected it shows the server's
 * libraries as tabs and a paginated grid of items with covers, fetched directly
 * from that server's ABS.
 */
export function ServerLibrary({ target }: { target: AbsTarget }) {
  const { state, error, connect, connected } = useConnect(target)

  if (!connected) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <BookOpen className="mx-auto text-muted-foreground" size={28} />
        <p className="mt-3 font-medium text-card-foreground">Connect to browse this library</p>
        <p className="t-muted mx-auto mt-1 max-w-sm text-[13px]">
          Sign in to this server with your HearthShelf account. A window opens
          briefly to complete sign-in, then your library appears here.
        </p>
        {state === 'error' && (
          <p className="t-muted mt-3 text-[13px] text-destructive">
            {error === 'popup_blocked'
              ? 'Your browser blocked the sign-in window. Allow popups and try again.'
              : error === 'popup_closed'
                ? 'Sign-in was cancelled.'
                : 'Could not connect. Please try again.'}
          </p>
        )}
        <div className="mt-5">
          <Button onClick={connect} disabled={state === 'connecting'}>
            {state === 'connecting' ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                Connecting...
              </>
            ) : (
              <>
                <Link2 size={16} />
                Connect
              </>
            )}
          </Button>
        </div>
      </div>
    )
  }

  return <ConnectedLibrary target={target} />
}

function ConnectedLibrary({ target }: { target: AbsTarget }) {
  const { data: libraries, isLoading, isError } = useLibraries(target, true)
  const [activeLib, setActiveLib] = useState<string | undefined>(undefined)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-muted-foreground">
        <Loader2 className="animate-spin" size={18} />
        <span className="t-body">Loading libraries...</span>
      </div>
    )
  }
  if (isError || !libraries) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-6">
        <AlertCircle className="mt-0.5 shrink-0 text-destructive" size={18} />
        <p className="t-body text-card-foreground">Couldn't load this server's libraries.</p>
      </div>
    )
  }
  if (libraries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="t-muted text-[13px]">This server has no libraries yet.</p>
      </div>
    )
  }

  const current = activeLib ?? libraries[0].id

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2">
        {libraries.map((lib) => (
          <button
            key={lib.id}
            onClick={() => setActiveLib(lib.id)}
            className={
              'rounded-lg px-3 py-1.5 text-[14px] font-medium transition-colors ' +
              (lib.id === current
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-accent')
            }
          >
            {lib.name}
          </button>
        ))}
      </div>
      <LibraryGrid target={target} libraryId={current} />
    </div>
  )
}

function LibraryGrid({ target, libraryId }: { target: AbsTarget; libraryId: string }) {
  const [page, setPage] = useState(0)
  const { data, isLoading, isError, isPlaceholderData } = useLibraryItems(
    target,
    libraryId,
    page,
    true
  )

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="animate-spin" size={18} />
        <span className="t-body">Loading items...</span>
      </div>
    )
  }
  if (isError || !data) {
    return <p className="t-muted p-6 text-[13px]">Couldn't load items.</p>
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.limit))

  return (
    <div>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {data.items.map((it) => {
          const cover = itemCoverUrl(target, it.id)
          return (
            <li key={it.id} className="group">
              <div className="aspect-square overflow-hidden rounded-lg border border-border bg-secondary">
                {cover ? (
                  // eslint-disable-next-line jsx-a11y/img-redundant-alt
                  <img
                    src={cover}
                    alt={it.title}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-muted-foreground">
                    <BookOpen size={24} />
                  </div>
                )}
              </div>
              <p className="mt-2 line-clamp-2 text-[13px] font-medium text-card-foreground">
                {it.title}
              </p>
              {it.author && <p className="t-muted line-clamp-1 text-[12px]">{it.author}</p>}
            </li>
          )
        })}
      </ul>

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <span className="t-muted text-[13px]">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page + 1 >= totalPages || isPlaceholderData}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
