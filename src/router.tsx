import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { ServerPickerPage } from '@/pages/ServerPickerPage'
import { ServerHomePage } from '@/pages/ServerHomePage'
import { SignInPage } from '@/pages/SignInPage'
import { SignUpPage } from '@/pages/SignUpPage'
import { ErrorPage } from '@/pages/ErrorPage'
import { RequireAuth } from '@/auth/RequireAuth'

export const router = createBrowserRouter([
  // Public account routes (embedded Clerk components). Splat paths so Clerk can
  // own its multi-step sub-routes (email verification, OAuth callback, etc.).
  { path: '/sign-in/*', element: <SignInPage /> },
  { path: '/sign-up/*', element: <SignUpPage /> },

  // Everything else requires sign-in.
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    errorElement: <ErrorPage />,
    children: [
      { path: '/', element: <ServerPickerPage /> },
      { path: '/server/:serverId', element: <ServerHomePage /> },
    ],
  },

  // Unmatched paths.
  { path: '*', element: <ErrorPage /> },
])
