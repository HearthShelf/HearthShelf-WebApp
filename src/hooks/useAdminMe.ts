import { useQuery } from '@tanstack/react-query'
import { fetchAdminMe, ApiError } from '@/api/controlPlane'

/**
 * Resolve whether the signed-in user is a platform admin. Shared by every nav
 * shell (desktop sidebar, mobile nav, top bar) plus the admin section shell so
 * they all read one cache entry and one set of options.
 *
 * A non-admin gets ApiError(403); an absent/expired session gets 401. Neither is
 * retried, and refetchOnWindowFocus is off: the platform_admins roster does not
 * change mid-session, so re-hitting /admin/me on every tab refocus would only
 * re-throw the same 403 (which flashed the failing URL in the browser status
 * bar on alt-tab).
 */
export function useAdminMe() {
  return useQuery({
    queryKey: ['admin-me'],
    queryFn: fetchAdminMe,
    retry: (count, e) =>
      !(e instanceof ApiError && (e.status === 403 || e.status === 401)) && count < 2,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
}
