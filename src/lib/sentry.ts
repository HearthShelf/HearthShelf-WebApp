/**
 * Crash reporting.
 *
 * One chokepoint: nothing else imports @sentry/react directly, so the DSN, the
 * noise filtering and the sampling all live here.
 *
 * Reports go to a self-hosted GlitchTip instance, not a third party. Session
 * Replay is deliberately off -- the app shows a user's own library, and a
 * recording of that is more data than a crash report needs.
 */
import * as Sentry from '@sentry/react'

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined

/** Errors that are control flow, not faults. */
function isNoise(event: Sentry.ErrorEvent): boolean {
  const value = event.exception?.values?.[0]?.value ?? ''
  // Handled by its own redirect flow, see main.tsx.
  if (value.includes('SessionExpired')) return true
  // The user navigated away mid-request, or is offline.
  if (value.includes('Failed to fetch')) return true
  if (value.includes('NetworkError')) return true
  // A lazy route chunk 404'd after a deploy; a reload fixes it.
  if (value.includes('Failed to fetch dynamically imported module')) return true
  return false
}

/** Call once, before the app renders. No-ops in dev and without a DSN. */
export function initSentry(): void {
  if (import.meta.env.DEV) return
  if (!DSN) return

  Sentry.init({
    dsn: DSN,
    environment: 'production',
    sendDefaultPii: false,
    maxBreadcrumbs: 50,
    integrations: [],
    tracesSampleRate: 0,
    beforeSend(event) {
      return isNoise(event) ? null : event
    },
  })
}

/** Tag the current user so an issue can be traced to an account. */
export function setSentryUser(userId: string | null): void {
  if (!DSN) return
  Sentry.setUser(userId ? { id: userId } : null)
}

export { Sentry }
