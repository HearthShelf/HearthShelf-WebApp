import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { ServerPickerPage } from '@/pages/ServerPickerPage'
import { ServerHomePage } from '@/pages/ServerHomePage'
import { ConnectedPage } from '@/pages/ConnectedPage'
import { ItemDetailPage } from '@/pages/ItemDetailPage'
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
      { path: '/server/:serverId', element: <ServerHomePage /> },
      { path: '/server/:serverId/item/:itemId', element: <ItemDetailPage /> },
      // Full-page fallback landing for the OIDC connect bounce (popup-blocked).
      { path: '/connected', element: <ConnectedPage /> },
    ],
  },

  // Unmatched paths.
  { path: '*', element: <ErrorPage /> },
])
