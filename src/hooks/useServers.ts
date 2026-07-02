/**
 * Server-list + linking hooks, backed by the control plane via TanStack Query.
 * Replaces the placeholder Zustand store. Components read live server state and
 * get cache invalidation on link/unlink for free.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchLinkedServers,
  fetchServerStatus,
  redeemPairingCode,
  unlinkServer,
  inviteToServer,
  setDefaultServer,
  clearDefaultServer,
  type ServerStatusResponse,
} from '@/api/controlPlane'
import type { LinkedServer } from '@/types/server'

const SERVERS_KEY = ['servers'] as const

export function useServers() {
  return useQuery<LinkedServer[]>({
    queryKey: SERVERS_KEY,
    queryFn: fetchLinkedServers,
  })
}

export function useServer(serverId: string | undefined) {
  const { data } = useServers()
  return data?.find((s) => s.id === serverId)
}

/**
 * Live reachability for one server, for the picker's status dot. Probed lazily
 * per server; cached briefly so re-renders don't re-probe, and refetched on a
 * slow interval so a server coming back online updates without a reload.
 */
export function useServerStatus(serverId: string | undefined) {
  return useQuery<ServerStatusResponse>({
    queryKey: ['server-status', serverId],
    queryFn: () => fetchServerStatus(serverId as string),
    enabled: Boolean(serverId),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    retry: false,
  })
}

export function useLinkServer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ code, displayName }: { code: string; displayName?: string }) =>
      redeemPairingCode(code, displayName),
    onSuccess: () => qc.invalidateQueries({ queryKey: SERVERS_KEY }),
  })
}

export function useUnlinkServer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (serverId: string) => unlinkServer(serverId),
    onSuccess: () => qc.invalidateQueries({ queryKey: SERVERS_KEY }),
  })
}

/**
 * Set (or clear) the user's default server - the one a fresh device
 * auto-connects to. Stored per MyHS account (control plane), so it follows the
 * user across devices. Pass null to clear. Invalidates the server list so the
 * `isDefault` flags update everywhere.
 */
export function useSetDefaultServer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (serverId: string | null) =>
      serverId ? setDefaultServer(serverId) : Promise.resolve(),
    onSuccess: () => qc.invalidateQueries({ queryKey: SERVERS_KEY }),
  })
}

export function useClearDefaultServer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (serverId: string) => clearDefaultServer(serverId),
    onSuccess: () => qc.invalidateQueries({ queryKey: SERVERS_KEY }),
  })
}

export function useInviteToServer(serverId: string) {
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role?: 'admin' | 'user' }) =>
      inviteToServer(serverId, email, role),
  })
}
