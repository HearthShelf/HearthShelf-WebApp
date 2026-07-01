import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useToast } from '@/hooks/useToast'
import { useActiveServer } from '@/hooks/useActiveServer'
import {
  getCommunityConfig,
  setCommunityConfig,
  socialKeys,
  type CommunityConfig,
} from '@/api/absSocial'

// Community (social) admin settings. The default-sharing setting governs whether
// a listener appears on the server leaderboard before they choose for themselves.
// The default only governs users who never set their own preference - changing it
// is retroactive for them but never overrides someone who chose for themselves.
export function ConfigCommunity() {
  const qc = useQueryClient()
  const { toast, show } = useToast()
  const { target } = useActiveServer()
  const { data, isLoading } = useQuery({
    queryKey: socialKeys.communityConfig(target?.serverId ?? ''),
    queryFn: () => getCommunityConfig(target!),
    enabled: Boolean(target),
    staleTime: 30 * 1000,
  })

  const save = useMutation({
    mutationFn: (defaultShare: boolean) => setCommunityConfig(target!, defaultShare),
    onSuccess: (next: CommunityConfig) => {
      qc.setQueryData(socialKeys.communityConfig(target!.serverId), next)
      show('Community settings saved')
    },
    onError: () => show('Could not save - admin permission required'),
  })

  if (!target || isLoading || !data) {
    return (
      <>
        <div className="page-head">
          <div className="eyebrow">Admin</div>
          <h1 className="title-xl">Community</h1>
        </div>
        <LoadingSpinner className="py-12" label="Loading..." />
      </>
    )
  }

  const sharing = data.defaultShare

  return (
    <>
      {toast && (
        <div className="p-toast">
          <Icon name="check_circle" fill /> {toast}
        </div>
      )}
      <div className="page-head">
        <div className="eyebrow">Admin</div>
        <h1 className="title-xl">Community</h1>
        <p className="page-sub">
          Shared, cross-user features - the server leaderboard and what listeners can see of each
          other.
        </p>
      </div>

      <div className="section-head">
        <Icon name="groups" />
        <h2>Default sharing</h2>
      </div>
      <div className="cfg-card">
        <div className="field full">
          <label>New and existing listeners appear on the leaderboard</label>
          <select
            className="fld"
            disabled={!data.canEdit || save.isPending}
            value={sharing ? 'on' : 'off'}
            onChange={(e) => save.mutate(e.target.value === 'on')}
          >
            <option value="on">On - opt-out (shared by default)</option>
            <option value="off">Off - opt-in (hidden by default)</option>
          </select>
        </div>
        <div className="banner info" style={{ marginTop: 'var(--s4)' }}>
          <Icon name="info" />
          {sharing
            ? 'Listeners are shown on the leaderboard unless they turn sharing off for themselves. Anyone who already chose to hide stays hidden.'
            : 'Listeners are hidden from the leaderboard unless they turn sharing on for themselves. Anyone who already chose to share stays shown.'}
        </div>
      </div>
    </>
  )
}
