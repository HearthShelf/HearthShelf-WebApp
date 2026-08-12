import { useQuery } from '@tanstack/react-query'
import { getServerVersions, hostedKeys } from '@/api/absHosted'
import { getLatestRelease } from '@/api/controlPlane'
import { compareSemver, latestReleaseKey } from '@/hooks/useUpdateStatus'

/**
 * The HearthShelf version one server is running, for the "My servers" list.
 *
 * The update banner only ever speaks for the server you're currently browsing,
 * so with several linked there was nowhere to see the rest. This reads each
 * server's own /hs/runtime directly and flags the ones behind the latest
 * release, so the whole account can be checked from one page.
 *
 * Renders nothing while loading or when the version can't be read (an offline
 * box shouldn't add a broken-looking row) - the status dot already covers
 * reachability.
 */
export function ServerVersion({ serverId, serverUrl }: { serverId: string; serverUrl: string }) {
  const { data } = useQuery({
    queryKey: hostedKeys.versions(serverId),
    queryFn: () => getServerVersions({ serverId, serverUrl }),
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  })

  const { data: latest } = useQuery({
    queryKey: latestReleaseKey,
    queryFn: getLatestRelease,
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  })

  const current = data?.hsVersion ?? null
  if (!current) return null

  const behind = Boolean(latest?.version && compareSemver(current, latest.version) < 0)

  return (
    <span className="t-muted shrink-0 text-[12px] tabular-nums">
      v{current}
      {behind && <span className="ml-1 text-primary">update</span>}
    </span>
  )
}
