import { useActiveServer } from '@/hooks/useActiveServer'
import { Icon } from '@/components/common/Icon'

// HearthShelf Connect. On a self-hosted box this section pairs the server to
// app.hearthshelf.com and manages its public address. In the hosted app the user
// is ALREADY connected through HearthShelf, so there is nothing to pair here -
// and the server's underlying address is deliberately never shown. This is a
// status panel: the server name + a plain "connected" state.
export function ConfigHosted() {
  const { server } = useActiveServer()
  const name = server?.name ?? 'This server'

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Admin</div>
        <h1 className="title-xl">HearthShelf Connect</h1>
        <p className="page-sub">
          How this server connects to HearthShelf so you and the people you invite
          can reach it from one place.
        </p>
      </div>

      <div className="section-head">
        <Icon name="link" />
        <h2>Connection</h2>
      </div>
      <div className="cfg-card">
        <div className="set-row">
          <div className="sr-meta">
            <div className="sr-t">Connected to HearthShelf</div>
            <div className="sr-d">
              {name} is reachable through the HearthShelf app. You're using that
              connection right now - there's nothing to set up here.
            </div>
          </div>
          <span className="badge-pill" style={{ color: '#7fbd6f' }}>
            Connected
          </span>
        </div>
      </div>

      <div className="banner info" style={{ marginTop: 'var(--s5)' }}>
        <Icon name="info" />
        Pairing, the server's public address, and reachability checks are managed
        on the server itself. Sign in on the server to change them.
      </div>
    </>
  )
}
