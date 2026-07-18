// POC seam for unifying the admin surface across the self-hosted SPA and the
// hosted WebApp. See the self-hosted copy of this file for the full rationale.
//
// This is the HOSTED implementation: the ambient target is the active linked
// server (useActiveServer), and requests go through the multi-server absClient
// bound to that server's AbsTarget. A config page consumes only
// useAdminDataSource(), so its body is identical to the self-hosted app's.

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useActiveServer } from '@/hooks/useActiveServer'
import { absGet, absPost, absPatch, absDelete } from '@/api/absClient'
import type { AbsTarget } from '@/api/absLibrary'

/** Minimal identity of the server an admin page is acting on. */
export interface AdminTarget {
  serverId: string
  serverUrl: string
}

export interface AdminDataSource {
  target: AdminTarget | null
  isMultiServer: boolean
  request: <T>(path: string, init?: RequestInit) => Promise<T>
}

const Ctx = createContext<AdminDataSource | null>(null)

export function AdminDataSourceProvider({ children }: { children: ReactNode }) {
  const { target, servers } = useActiveServer()
  const value = useMemo<AdminDataSource>(() => {
    const t: AbsTarget | null = target
    return {
      target: t ? { serverId: t.serverId, serverUrl: t.serverUrl } : null,
      isMultiServer: (servers?.length ?? 0) > 1,
      request: <T,>(path: string, init?: RequestInit): Promise<T> => {
        if (!t) throw new Error('no_active_server')
        // Dispatch to the public verb helpers by method. Body (if any) is a JSON
        // string in init.body, matching the self-hosted RequestInit shape; parse
        // it back for the helpers that take an object.
        const method = (init?.method || 'GET').toUpperCase()
        const parseBody = () =>
          typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : undefined
        if (method === 'GET') return absGet<T>(t, path)
        if (method === 'POST') return absPost<T>(t, path, parseBody()) as Promise<T>
        if (method === 'PATCH') return absPatch<T>(t, path, parseBody()) as Promise<T>
        if (method === 'DELETE') return absDelete<T>(t, path) as Promise<T>
        return absGet<T>(t, path)
      },
    }
  }, [target, servers])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAdminDataSource(): AdminDataSource {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAdminDataSource must be used within AdminDataSourceProvider')
  return v
}
