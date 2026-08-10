import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, Cloud, ExternalLink, Loader2, Monitor, Store } from 'lucide-react'
import { fetchStoreApps, type AppScope } from '@/api/controlPlane'

/**
 * The app store: /apps
 *
 * WHAT IS AND IS NOT HERE. Only reviewed hosted services appear. Self-hosted
 * apps - the ones each user runs their own copy of, like Audplexus or a Home
 * Assistant integration - are deliberately absent, and that is not an oversight:
 * there is nothing to list. Listing one would mean listing SOFTWARE rather than
 * a service, and a shared listing would imply a shared client secret inside a
 * public binary. Those apps register themselves and are connected from within
 * the app itself, so the store would be a dead end for them.
 *
 * That is why this page tells the user how to connect a self-hosted app rather
 * than pretending the store is the only route. An empty store must still be a
 * useful page.
 */

const SCOPE_TEXT: Record<AppScope, string> = {
  'library:read': 'Read your library',
  'library:write': 'Add and update books',
  'progress:read': 'Read your progress',
  'progress:write': 'Update your progress',
  admin: 'Administer your server',
}

export function AppStorePage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['store-apps'], queryFn: fetchStoreApps })

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center gap-2">
        <Store size={18} className="text-muted-foreground" />
        <div>
          <p className="t-eyebrow">Apps</p>
          <h1 className="t-h1 mt-1">App store</h1>
        </div>
      </div>
      <p className="t-muted mt-3 text-[13px]">
        Services you can connect to your HearthShelf servers. You choose which servers each app can
        reach, and you can disconnect it at any time from{' '}
        <Link to="/account/connections" className="underline hover:text-foreground">
          Connected apps
        </Link>
        .
      </p>

      <div className="mt-6">
        {isLoading ? (
          <Panel>
            <Loader2 className="animate-spin" size={18} />
            <span className="t-body">Loading apps...</span>
          </Panel>
        ) : error ? (
          <Panel>
            <AlertTriangle size={18} className="text-destructive" />
            <span className="t-body">
              Could not load the store: {error instanceof Error ? error.message : 'unknown error'}
            </span>
          </Panel>
        ) : !data?.length ? (
          <Panel>
            <Store size={18} className="text-muted-foreground" />
            <span className="t-body">No apps are listed yet.</span>
          </Panel>
        ) : (
          <ul className="grid gap-2">
            {data.map((app) => (
              <li key={app.app_id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  <Cloud size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-card-foreground">{app.name}</h2>
                      {app.homepage_url && (
                        <a
                          href={app.homepage_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="t-muted inline-flex shrink-0 items-center gap-0.5 text-[12px] hover:text-foreground"
                        >
                          <ExternalLink size={12} />
                          site
                        </a>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {app.requested_scopes.map((s) => (
                        <span
                          key={s}
                          className={
                            'rounded px-1.5 py-0.5 text-[11px] ' +
                            (s === 'admin'
                              ? 'bg-destructive/15 text-destructive'
                              : 'bg-muted text-muted-foreground')
                          }
                        >
                          {SCOPE_TEXT[s] ?? s}
                        </span>
                      ))}
                    </div>
                    <p className="t-muted mt-2 text-[12px]">
                      Start from the app itself - it will show you a code to enter here.
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The store never lists self-hosted apps, so it must not read as the only
          way to connect something. This is the other half of the story. */}
      <div className="mt-8 rounded-lg border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <Monitor size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-card-foreground">Running your own app?</h2>
            <p className="t-muted mt-1 text-[13px]">
              Self-hosted apps you run yourself - like Audplexus - are not listed here, because
              everyone runs their own copy. Connect one from inside the app: it will show you a
              code, and you enter it on the{' '}
              <Link to="/connect" className="underline hover:text-foreground">
                connect page
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-muted-foreground">
      {children}
    </div>
  )
}
