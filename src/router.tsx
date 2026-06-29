import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { ActiveServerMediaUI } from '@/components/shared/ActiveServerMediaUI'
import { HomePage } from '@/pages/HomePage'
import { LibraryPage } from '@/pages/LibraryPage'
import { ItemDetailPage } from '@/pages/ItemDetailPage'
import { AuthorDetailPage } from '@/pages/AuthorDetailPage'
import { SeriesDetailPage } from '@/pages/SeriesDetailPage'
import { CollectionsPage } from '@/pages/CollectionsPage'
import { CollectionDetailPage } from '@/pages/CollectionDetailPage'
import { NarratorsPage } from '@/pages/NarratorsPage'
import { SearchPage } from '@/pages/SearchPage'
import { StatsPage } from '@/pages/StatsPage'
import { SessionsPage } from '@/pages/SessionsPage'
import { PlayerPage } from '@/pages/PlayerPage'
import { ReaderPage } from '@/pages/ReaderPage'
import { AccountPage } from '@/pages/AccountPage'
import { InvitePage } from '@/pages/InvitePage'
import { ConnectBoxPage } from '@/pages/ConnectBoxPage'
import { InfraLogsPage } from '@/pages/InfraLogsPage'
import { AdminLayout } from '@/pages/admin/AdminLayout'
import { AdminServersPage } from '@/pages/admin/AdminServersPage'
import { AdminAdminsPage } from '@/pages/admin/AdminAdminsPage'
import { AdminAuditPage } from '@/pages/admin/AdminAuditPage'
import { SignInPage } from '@/pages/SignInPage'
import { SignUpPage } from '@/pages/SignUpPage'
import { ErrorPage } from '@/pages/ErrorPage'
import { RequireAuth } from '@/auth/RequireAuth'
import { PlayerProvider } from '@/player/PlayerProvider'

// The library shell: the persistent frame + the active-server connection +
// the shared MediaUI provider. Every library/browse page renders inside this,
// so none of them carry a server id in the URL - the active server is ambient.
function withShell(element: React.ReactNode) {
  return <ActiveServerMediaUI>{element}</ActiveServerMediaUI>
}

export const router = createBrowserRouter([
  // Public account routes (embedded Clerk components). Splat paths so Clerk can
  // own its multi-step sub-routes (email verification, OAuth callback, etc.).
  { path: '/sign-in/*', element: <SignInPage /> },
  { path: '/sign-up/*', element: <SignUpPage /> },

  // Everything else requires sign-in.
  {
    element: (
      <RequireAuth>
        <PlayerProvider>
          <AppShell />
        </PlayerProvider>
      </RequireAuth>
    ),
    errorElement: <ErrorPage />,
    children: [
      // Library surfaces - all scoped to the ambient active server.
      { path: '/', element: withShell(<HomePage />) },
      { path: '/library', element: withShell(<LibraryPage />) },
      { path: '/book/:itemId', element: withShell(<ItemDetailPage />) },
      { path: '/author/:authorId', element: withShell(<AuthorDetailPage />) },
      { path: '/series/:seriesId', element: withShell(<SeriesDetailPage />) },
      { path: '/collections', element: withShell(<CollectionsPage />) },
      { path: '/collections/:collectionId', element: withShell(<CollectionDetailPage />) },
      { path: '/narrators', element: withShell(<NarratorsPage />) },
      { path: '/search', element: withShell(<SearchPage />) },
      { path: '/stats', element: withShell(<StatsPage />) },
      { path: '/sessions', element: withShell(<SessionsPage />) },
      { path: '/player', element: withShell(<PlayerPage />) },
      { path: '/reader/:itemId', element: withShell(<ReaderPage />) },

      // Account (Clerk profile + My Servers + plan). No active-server gate - it
      // manages servers, so it must render even with zero linked.
      { path: '/account', element: <AccountPage /> },

      // Deep-link entry points. These resolve a server id from the query, set it
      // active, and bounce to the clean library - the UUID never sticks in the URL.
      { path: '/pair', element: <Navigate to="/account" replace /> },
      { path: '/invite', element: <InvitePage /> },
      { path: '/connect-box', element: <ConnectBoxPage /> },

      // Platform-admin area (gated to the platform_admins roster by the CP).
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminServersPage /> },
          { path: 'servers', element: <AdminServersPage /> },
          { path: 'admins', element: <AdminAdminsPage /> },
          { path: 'audit', element: <AdminAuditPage /> },
          { path: 'logs', element: <InfraLogsPage /> },
        ],
      },
      { path: '/infra-logs', element: <Navigate to="/admin/logs" replace /> },
      // Old server-scoped deep links -> clean equivalents.
      { path: '/server/:serverId', element: <Navigate to="/" replace /> },
    ],
  },

  { path: '*', element: <ErrorPage /> },
])
