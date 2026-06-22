import { create } from 'zustand'
import type { LinkedServer } from '@/types/server'

interface ServerState {
  servers: LinkedServer[]
  activeServerId: string | null
  setActiveServer: (id: string | null) => void
  /**
   * TODO(control-plane): replace with a TanStack Query fetch against the
   * control plane that returns this user's linked servers. Until Clerk +
   * the Worker exist, we seed a placeholder so the shell is navigable.
   */
  loadServers: () => void
}

const PLACEHOLDER_SERVERS: LinkedServer[] = [
  { id: 'demo-1', name: 'Home Library', url: 'https://books.jpdev.us', status: 'online', role: 'admin' },
  { id: 'demo-2', name: "Mom's Server", url: 'https://example.invalid', status: 'unknown', role: 'user' },
]

export const useServerStore = create<ServerState>((set) => ({
  servers: [],
  activeServerId: null,
  setActiveServer: (id) => set({ activeServerId: id }),
  loadServers: () => set({ servers: PLACEHOLDER_SERVERS }),
}))
