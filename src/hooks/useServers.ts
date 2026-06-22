/**
 * Server-list + linking hooks, backed by the control plane via TanStack Query.
 * Replaces the placeholder Zustand store. Components read live server state and
 * get cache invalidation on link/unlink for free.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchLinkedServers,
  redeemPairingCode,
  unlinkServer,
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
