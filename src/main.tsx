import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { Toaster } from 'sonner'
import { router } from '@/router'
import { AuthTokenBridge } from '@/auth/AuthTokenBridge'
import { notify } from '@/lib/notify'
import { ApiError, SessionExpiredError } from '@/api/controlPlane'
import { isHostedOutage } from '@/api/absHosted'
import { initSentry, reportMissingSessionToken, Sentry } from '@/lib/sentry'
import './styles/index.css'

initSentry()

// Control-plane refusals caused by what the user typed, such as a mistyped,
// used or expired pairing code. The toast explains them; they are not faults.
const USER_MISTAKE_CODES = new Set([
  'invalid_code',
  'code_already_used',
  'code_expired',
  'rate_limited',
])

// Surface failures instead of letting them die silently. Session-expiry is
// handled by its own flow (redirect + message), so we don't double-toast it.
// A caller that shows its own message sets `meta: { handlesOwnErrors: true }`.
function reportError(err: unknown, meta: Record<string, unknown> | undefined) {
  if (err instanceof SessionExpiredError) return
  if (meta?.handlesOwnErrors !== true) {
    notify.error(notify.fromError(err, 'Could not reach HearthShelf'))
  }

  // Answers rather than faults: the toast (or the page) already tells the user,
  // and a crash report would only bury the real ones.
  if (err instanceof ApiError && err.status === 403) return
  if (err instanceof ApiError && USER_MISTAKE_CODES.has(err.message)) return
  if (isHostedOutage(err)) return
  // request() turns a 401 on a request that carried a token into
  // SessionExpiredError, so this one went out with no token at all.
  if (err instanceof ApiError && err.status === 401) {
    reportMissingSessionToken(window.location.pathname)
    return
  }
  Sentry.captureException(err)
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (err, query) => reportError(err, query.meta) }),
  mutationCache: new MutationCache({
    onError: (err, _vars, _result, mutation) => reportError(err, mutation.meta),
  }),
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
