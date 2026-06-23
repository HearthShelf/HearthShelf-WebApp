import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { Toaster } from 'sonner'
import { router } from '@/router'
import { ClerkTokenBridge } from '@/auth/ClerkTokenBridge'
import { clerkAppearance } from '@/auth/clerkAppearance'
import { notify } from '@/lib/notify'
import { SessionExpiredError } from '@/api/controlPlane'
import './styles/index.css'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (!PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY')
}

// Surface failures instead of letting them die silently. Session-expiry is
// handled by its own flow (redirect + message), so we don't double-toast it.
function reportQueryError(err: unknown) {
  if (err instanceof SessionExpiredError) return
  notify.error(notify.fromError(err, 'Could not reach HearthShelf'))
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: reportQueryError }),
  mutationCache: new MutationCache({ onError: reportQueryError }),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Toaster sits OUTSIDE ClerkProvider so notifications still render even if
        Clerk fails to initialize (e.g. a config/network problem). */}
    <Toaster theme="dark" position="bottom-right" richColors closeButton />
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl="/sign-in?signed_out=1"
      appearance={clerkAppearance}
    >
      {/* Keeps the control-plane API client pointed at Clerk's token getter. */}
      <ClerkTokenBridge />
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ClerkProvider>
  </StrictMode>
)
