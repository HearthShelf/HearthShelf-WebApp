/**
 * Active-server ambient state.
 *
 * The hosted front door is multi-server, but most users have exactly one. So
 * rather than carry a server id in every URL (Plex never makes you look at a
 * server UUID), we keep the "currently selected server" here as ambient state,
 * persisted to localStorage so a reload lands you back where you were.
 *
 * This store holds ONLY the id. Resolving it to a LinkedServer / AbsTarget, and
 * reconciling it against the live linked-server list (auto-select the only one,
 * recover when the active one unlinks), happens in useActiveServer() where the
 * React Query data is available.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ActiveServerState {
  activeServerId: string | null
  setActiveServer: (id: string | null) => void
}

export const useActiveServerStore = create<ActiveServerState>()(
  persist(
    (set) => ({
      activeServerId: null,
      setActiveServer: (id) => set({ activeServerId: id }),
    }),
    { name: 'hs-active-server' }
  )
)
