/**
 * Active-library state for the connected server's shell.
 *
 * The hosted app browses ONE server at a time (resolved by useActiveServer).
 * Within that server it browses one library at a time. This hook is the single
 * source of truth for "which library am I in": it fetches the active server's
 * libraries (once connected), tracks a user-selected override, and falls back to
 * the first library. It also reads the active library's item count for the
 * sidebar badge, mirroring the self-hosted shell.
 */
import { create } from 'zustand'
import { useConnectActiveServer } from '@/hooks/useConnectActiveServer'
import { useLibraries, useLibraryItems } from '@/hooks/useLibrary'
import { useActiveServer } from '@/hooks/useActiveServer'
import type { AbsLibrary, AbsTarget } from '@/api/absLibrary'

// User-selected library override (set by the AppBar switcher). Keyed per server
// so switching servers doesn't carry a stale library id across.
interface ActiveLibraryStore {
  selectedByServer: Record<string, string>
  select: (serverId: string, libraryId: string) => void
}
const useActiveLibraryStore = create<ActiveLibraryStore>((set) => ({
  selectedByServer: {},
  select: (serverId, libraryId) =>
    set((s) => ({ selectedByServer: { ...s.selectedByServer, [serverId]: libraryId } })),
}))

// ABS mediaType -> a Material Symbol. ABS ships its own icon names that aren't
// Material Symbols, so map by mediaType.
export function libraryIcon(library: Pick<AbsLibrary, 'mediaType'>): string {
  return library.mediaType === 'podcast' ? 'podcasts' : 'menu_book'
}

export interface ActiveLibrary {
  target: AbsTarget | null
  connected: boolean
  libraries: AbsLibrary[]
  active: AbsLibrary | null
  activeId: string | null
  itemCount: number | null
  select: (libraryId: string) => void
}

export function useActiveLibrary(routeId?: string): ActiveLibrary {
  const { target } = useActiveServer()
  const { connected } = useConnectActiveServer()
  const selectedByServer = useActiveLibraryStore((s) => s.selectedByServer)
  const selectRaw = useActiveLibraryStore((s) => s.select)

  const { data: libraries = [] } = useLibraries(
    target ?? { serverId: '', serverUrl: '' },
    Boolean(target) && connected
  )

  const serverId = target?.serverId ?? ''
  const selectedId = serverId ? selectedByServer[serverId] : undefined
  const activeId = selectedId ?? libraries[0]?.id ?? routeId ?? null
  const active = libraries.find((l) => l.id === activeId) ?? null

  // Item count for the sidebar badge. ABS treats limit as page size; we read
  // `total` off a 1-item page rather than pulling the whole library.
  const { data: countData } = useLibraryItems(
    target ?? { serverId: '', serverUrl: '' },
    activeId ?? undefined,
    0,
    Boolean(target) && connected && Boolean(activeId)
  )

  return {
    target,
    connected,
    libraries,
    active,
    activeId,
    itemCount: countData?.total ?? null,
    select: (libraryId: string) => serverId && selectRaw(serverId, libraryId),
  }
}
