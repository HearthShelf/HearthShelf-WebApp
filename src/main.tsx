import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { Toaster } from 'sonner'
import { router } from '@/router'
import { AuthTokenBridge } from '@/auth/AuthTokenBridge'
import { notify } from '@/lib/notify'
import { SessionExpiredError } from '@/api/controlPlane'
import { initSentry, Sentry } from '@/lib/sentry'
import './styles/index.css'

initSentry()

// Surface failures instead of letting them die silently. Session-expiry is
// handled by its own flow (redirect + message), so we don't double-toast it.
function reportQueryError(err: unknown) {
  if (err instanceof SessionExpiredError) return
  notify.error(notify.fromError(err, 'Could not reach HearthShelf'))
  Sentry.captureException(err)
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: reportQueryError }),
  mutationCache: new MutationCache({ onError: reportQueryError }),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Toaster theme="dark" position="bottom-right" richColors closeButton />
    {/* The auth client is a module singleton (auth/client.ts), so there is no
        provider to mount - only the bridge that points the control-plane API
        client at the current session token. */}
    <AuthTokenBridge />
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
