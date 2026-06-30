/**
 * QuestGiver + Discover share ONE config on the active server's HearthShelf
 * backend: /hs/questgiver/config. This hook is the single source of truth for
 * both surfaces' enablement (the QuestGiver nav item + route gate AND the
 * Discover nav item + route gate).
 *
 * Both default to ENABLED until the backend explicitly disables them, matching
 * the self-hosted app: QuestGiver shows unless featureEnabled === false, Discover
 * shows unless discoverEnabled === false. getQgConfig degrades gracefully (see
 * absQuestGiver.ts), so this never breaks the nav.
 */
import { useQuery } from '@tanstack/react-query'
import { useActiveServer } from '@/hooks/useActiveServer'
import { getQgConfig, type QgConfig } from '@/api/absQuestGiver'

// Shared config query - drives the QuestGiver + Discover nav items, their route
// gates, and the QuestGiver page header. Keyed per server. Cached for 5 minutes;
// the admin feature flags change rarely.
export function useQgConfig() {
  const { target } = useActiveServer()
  return useQuery<QgConfig>({
    queryKey: ['qg-config', target?.serverId],
    queryFn: () => getQgConfig(target!),
    enabled: Boolean(target),
    staleTime: 5 * 60 * 1000,
  })
}

// True when QuestGiver should be shown. Treated as enabled until the config
// resolves (and on any backend failure), so the nav doesn't flicker; the gate
// hides it only on an explicit featureEnabled:false from the backend.
export function useQuestGiverEnabled(): boolean {
  const { data } = useQgConfig()
  return data?.featureEnabled !== false
}

// Discover shares the same config payload. Like QuestGiver it defaults to enabled
// until the backend explicitly says otherwise, so it works in local dev too.
export function useDiscoverEnabled(): boolean {
  const { data } = useQgConfig()
  return data?.discoverEnabled !== false
}
