import { Icon } from '@/components/common/Icon'

/**
 * Connections: external/social account links.
 *
 * In the hosted front door, Clerk owns identity, so connected social accounts
 * (Google, Apple, etc.) are managed in the Profile & sign-in tab, not here -
 * we point there rather than duplicating Clerk's connected-accounts UI.
 *
 * The self-hosted app also surfaces server-side integrations here (ReadMeABook,
 * external book links). Those live on the HearthShelf Node backend, which the
 * hosted SPA does not talk to (it speaks straight to ABS), so they're admin-
 * managed on the server and we just note where to find them.
 */
export function ConnectionsSettings() {
  return (
    <section>
      <div className="section-head">
        <Icon name="hub" />
        <h2>Connections</h2>
      </div>
      <p className="t-muted mb-4 text-[13px]">
        Where your linked accounts and server integrations live.
      </p>

      <div className="cfg-card">
        <div className="cfg-line">
          <Icon name="link" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Connected accounts</div>
            <div className="cl-d">
              Google, Apple and other sign-in providers are managed by your
              HearthShelf account. Open the Profile &amp; sign-in tab to connect
              or remove them.
            </div>
          </div>
        </div>
      </div>

      <div className="cfg-card" style={{ marginTop: 'var(--s4)' }}>
        <div className="cfg-line">
          <Icon name="hub" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Server integrations</div>
            <div className="cl-d">
              ReadMeABook, external book links (Goodreads, Audible, Hardcover)
              and similar integrations are set up by your server admin under
              Server &rarr; Integrations on the server itself.
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
