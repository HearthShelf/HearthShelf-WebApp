import { useQuery } from '@tanstack/react-query'
import { getCustomProviders, adminContentKeys } from '@/api/absAdmin'
import { useActiveServer } from '@/hooks/useActiveServer'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

// Integrations. The HearthShelf-managed integrations (ReadMeABook, Audplexus,
// Audible catalog region) are configured on the server itself - they live in the
// self-hosted HearthShelf backend, not in ABS - so they aren't editable from the
// hosted app. What IS reachable here is ABS's own custom metadata providers,
// shown read-only.
export function ConfigIntegrations() {
  const { target } = useActiveServer()
  const { data } = useQuery({
    queryKey: adminContentKeys.customProviders(target?.serverId ?? ''),
    queryFn: () => getCustomProviders(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })
  const providers = data?.providers ?? []

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Admin</div>
        <h1 className="title-xl">Integrations</h1>
        <p className="page-sub">
          Metadata providers AudiobookShelf uses for matching and search.
        </p>
      </div>

      <div className="banner info" style={{ marginBottom: 'var(--s5)' }}>
        <Icon name="info" />
        ReadMeABook, Audplexus, and the Audible catalog region are managed on the
        server itself. Sign in on the server to change them.
      </div>

      <div className="section-head">
        <Icon name="travel_explore" />
        <h2>Custom metadata providers</h2>
      </div>
      {!data ? (
        <LoadingSpinner className="py-8" label="Loading..." />
      ) : providers.length === 0 ? (
        <div className="empty-state">
          <Icon name="extension_off" />
          <h3>No custom providers</h3>
          <p>
            Built-in providers (Audible, Google, iTunes, Open Library) are always
            available.
          </p>
        </div>
      ) : (
        <div className="cfg-card">
          {providers.map((p) => (
            <div className="cfg-line" key={p.id}>
              <Icon name="travel_explore" style={{ color: 'var(--text-muted)' }} />
              <div className="cl-meta">
                <div className="cl-t">{p.name}</div>
              </div>
              <span style={{ color: 'var(--text-muted)' }}>{p.url}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
