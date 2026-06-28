import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { ServerPickerPage } from '@/pages/ServerPickerPage'
import { ServerHomePage } from '@/pages/ServerHomePage'
import { ConnectedPage } from '@/pages/ConnectedPage'
import { InvitePage } from '@/pages/InvitePage'
import { ItemDetailPage } from '@/pages/ItemDetailPage'
import { AuthorDetailPage } from '@/pages/AuthorDetailPage'
import { CollectionDetailPage } from '@/pages/CollectionDetailPage'
import { AccountPage } from '@/pages/AccountPage'
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
          <AppLayout />
        </PlayerProvider>
      </RequireAuth>
    ),
    errorElement: <ErrorPage />,
    children: [
      { path: '/', element: <ServerPickerPage /> },
      // Deep link from a HS server's "Connect" flow: /pair?code=XXXX-XXXX.
      // Same picker, but it auto-opens the link dialog prefilled with the code.
      { path: '/pair', element: <ServerPickerPage /> },
      // Deeplink from the branded invite email: /invite?server=ID. Waits for the
      // pending invite to materialize, then lands on that server's library.
      { path: '/invite', element: <InvitePage /> },
      { path: '/server/:serverId', element: <ServerHomePage /> },
      { path: '/server/:serverId/item/:itemId', element: <ItemDetailPage /> },
      { path: '/server/:serverId/author/:authorId', element: <AuthorDetailPage /> },
      { path: '/server/:serverId/collection/:collectionId', element: <CollectionDetailPage /> },
      { path: '/account', element: <AccountPage /> },
      // Platform-admin area. The control plane gates every /admin endpoint to the
      // platform_admins D1 roster; the layout also checks /admin/me so a non-admin
      // who deep-links here gets a clean "not authorized" panel.
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminServersPage /> },
          { path: 'servers', element: <AdminServersPage /> },
          { path: 'admins', element: <AdminAdminsPage /> },
          { path: 'audit', element: <AdminAuditPage /> },
        ],
      },
      // Platform-admin infra log viewer (CP gates to the platform_admins roster;
      // non-admins see a "not authorized" panel). Linked from the Admin area.
      { path: '/infra-logs', element: <InfraLogsPage /> },
      // Full-page fallback landing for the OIDC connect bounce (popup-blocked).
      { path: '/connected', element: <ConnectedPage /> },
    ],
  },

  // Unmatched paths.
  { path: '*', element: <ErrorPage /> },
])
