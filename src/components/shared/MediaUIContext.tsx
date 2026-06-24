import { createContext, useContext, type ReactNode } from 'react'

/**
 * MediaUIProvider — the seam that lets presentational media components be SHARED
 * between the HearthShelf server app and this WebApp without either app's
 * routing, player, auth, or data layer leaking into the component.
 *
 * Both apps render the same dumb components (BookTile, SeriesCard, ...). Those
 * components read app-specific capabilities from this context instead of
 * importing app stores/hooks directly. Each app mounts ONE provider at the top
 * with its own implementations:
 *   - HearthShelf: cover via /abs-api + ABS token from authStore; routes /book/:id
 *   - WebApp:      cover via absMediaUrl (cross-origin + per-server token);
 *                  routes /server/:sid/item/:id
 *
 * The value is set ONCE at mount and never changes, so it triggers no
 * context-driven re-renders (same category as a theme/auth provider). Keep the
 * functions referentially stable (useMemo/useCallback) in each app's provider.
 */
export interface MediaUI {
  /** Cover image URL for an item id (already auth-tokenized), or null. */
  coverUrl: (itemId: string, width?: number) => string | null
  /** Navigate to an item's detail/player page. */
  openItem: (itemId: string) => void
  /** Start playback of an item (or navigate to its player). */
  playItem: (itemId: string) => void
  /** Optional: href for an author page, or null if the app doesn't have one. */
  authorHref?: (authorId: string) => string | null
  /** Optional: href for a series page, or null. */
  seriesHref?: (seriesId: string) => string | null
  /** Optional: href for a library view filtered to a narrator, or null. */
  narratorHref?: (narrator: string) => string | null
  /** Optional: href for a library view filtered to a genre, or null. */
  genreHref?: (genre: string) => string | null
  /** Optional: mark finished/unfinished; omitted if the app doesn't support it. */
  markFinished?: (itemId: string, finished: boolean) => void
}

const MediaUIContext = createContext<MediaUI | null>(null)

export function MediaUIProvider({ value, children }: { value: MediaUI; children: ReactNode }) {
  return <MediaUIContext.Provider value={value}>{children}</MediaUIContext.Provider>
}

/** Read the host app's media capabilities. Throws if no provider is mounted. */
export function useMediaUI(): MediaUI {
  const ctx = useContext(MediaUIContext)
  if (!ctx) {
    throw new Error('useMediaUI must be used within a <MediaUIProvider>')
  }
  return ctx
}
