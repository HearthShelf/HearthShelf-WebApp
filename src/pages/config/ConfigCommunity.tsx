import { Icon } from '@/components/common/Icon'

// Community (social) admin settings. The default-sharing toggle that governs
// whether listeners appear on the server leaderboard is stored in the
// self-hosted HearthShelf backend on the server, not in ABS. The hosted app has
// no admin path to it, so this is an informative panel. Per-user sharing choices
// are still made by each listener in their own settings.
export function ConfigCommunity() {
  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Admin</div>
        <h1 className="title-xl">Community</h1>
        <p className="page-sub">
          Shared, cross-user features - the server leaderboard and what listeners
          can see of each other.
        </p>
      </div>

      <div className="empty-state">
        <Icon name="groups" />
        <h3>Configured on the server</h3>
        <p>
          The leaderboard's default sharing setting is managed on the server
          itself. Sign in on the server to change it. Each listener still controls
          their own sharing from their settings.
        </p>
      </div>
    </>
  )
}
