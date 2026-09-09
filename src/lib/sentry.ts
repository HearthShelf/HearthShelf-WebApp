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
    // Default integrations, deliberately. An earlier `integrations: []` turned
    // off Breadcrumbs and GlobalHandlers, which meant a report arrived with no
    // trail of what led to it - a sign-in bug that was three failing requests
    // in a row showed up as a single context-free error. Session Replay is
    // still off (it is opt-in, not a default).
    tracesSampleRate: 0,
    beforeSend(event) {
      return isNoise(event) ? null : event
    },
  })
}

/**
 * Record a step in the sign-in flow.
 *
 * Sign-in spans three services (this app, the accounts service, the control
 * plane) and fails in ways that all look identical from the outside: the user
 * lands back on the sign-in page. Only the SEQUENCE distinguishes them - which
 * request 404'd, whether a token was obtained, whether the control plane
 * rejected it - and that sequence is gone by the time anyone can ask.
 *
 * These breadcrumbs ride along on whatever error is eventually reported.
 */
export function authBreadcrumb(message: string, data?: Record<string, unknown>): void {
  if (!DSN) return
  Sentry.addBreadcrumb({ category: 'auth', level: 'info', message, data })
}

/**
 * Report that a user was bounced back to sign-in by an expired session.
 *
 * Deliberately reported rather than filtered as noise. It is control flow when
 * a session genuinely ages out, but it is ALSO the exact symptom of every
 * misconfiguration between the app, the accounts service and the control plane
 * - and treating it as noise is what made one such outage invisible. The rate
 * of this event is the signal: a trickle is normal, a spike is an outage.
 */
export function reportSessionExpired(path: string): void {
  if (!DSN) return
  Sentry.captureMessage('Session rejected, redirecting to sign-in', {
    level: 'warning',
    tags: { auth_flow: 'session_expired' },
    extra: { path },
  })
}

/** Tag the current user so an issue can be traced to an account. */
export function setSentryUser(userId: string | null): void {
  if (!DSN) return
  Sentry.setUser(userId ? { id: userId } : null)
}

export { Sentry }
