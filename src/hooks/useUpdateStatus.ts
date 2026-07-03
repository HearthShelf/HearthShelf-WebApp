/**
 * Compare the active server's running HearthShelf version against the newest
 * release the control plane knows about, and decide how loudly (if at all) to
 * prompt an update. Drives UpdateBanner and the "vY available" chip in Settings.
 *
 * The box's live version comes from getServerVersions (reads the box's own
 * /hs/runtime); the latest release comes from the control plane's GitHub-backed
 * cache. Both are cached ~6h - update prompts don't need to be live.
 */
import { useQuery } from '@tanstack/react-query'
import { getLatestRelease, type LatestRelease, type UpdateSeverity } from '@/api/controlPlane'
import { getServerVersions, hostedKeys } from '@/api/absHosted'
import { useActiveServer } from '@/hooks/useActiveServer'

/** Compare two semver-ish strings. -1 if a<b, 0 if equal, 1 if a>b. Missing
 *  minor/patch count as 0; non-numeric sorts low. Mirrors the control plane's
 *  compareSemver so both ends agree on "outdated". */
export function compareSemver(a: string, b: string): number {
  const norm = (s: string) =>
    (String(s)
      .trim()
      .replace(/^v/i, '')
      .match(/^\d+(\.\d+){0,2}/)?.[0] ?? '')
      .split('.')
      .map(Number)
  const pa = norm(a)
  const pb = norm(b)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}

export interface UpdateStatus {
  /** The version the active box is running (null if unknown/undetected). */
  current: string | null
  /** The newest release, or null when the cache is empty / still loading. */
  latest: LatestRelease | null
  severity: UpdateSeverity | null
  /** True when current is strictly older than latest (and current is known). */
  updateAvailable: boolean
  /** True when current is below the release's min_supported floor: force-update. */
  belowMinSupported: boolean
  /** Is the signed-in user an admin of the active server (can actually update)? */
  isAdmin: boolean
  isLoading: boolean
}

const latestReleaseKey = ['releases', 'latest'] as const

export function useUpdateStatus(): UpdateStatus {
  const { target, server } = useActiveServer()

  const versions = useQuery({
    queryKey: hostedKeys.versions(target?.serverId ?? ''),
    queryFn: () => getServerVersions(target!),
    enabled: Boolean(target),
    staleTime: 6 * 60 * 60 * 1000,
  })

  const latest = useQuery({
    queryKey: latestReleaseKey,
    queryFn: getLatestRelease,
    staleTime: 6 * 60 * 60 * 1000,
  })

  const current = versions.data?.hsVersion ?? null
  const release = latest.data ?? null

  const updateAvailable = Boolean(current && release && compareSemver(current, release.version) < 0)
  const belowMinSupported = Boolean(
    current && release?.min_supported && compareSemver(current, release.min_supported) < 0,
  )

  return {
    current,
    latest: release,
    severity: release?.severity ?? null,
    updateAvailable,
    belowMinSupported,
    isAdmin: server?.role === 'admin',
    isLoading: versions.isLoading || latest.isLoading,
  }
}
