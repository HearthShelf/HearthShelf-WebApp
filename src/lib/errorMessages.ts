/**
 * Central map from machine-readable backend error codes to human-readable copy.
 *
 * Both the box's HearthShelf backend (HostedError) and the control plane
 * (ApiError) answer failures with a short code like `broker_unreachable` or
 * `not_paired`. Those codes ride as the thrown Error's `message`, so any call
 * site that toasts `err.message` directly leaks the raw code to the user.
 *
 * `friendlyError()` is the single seam that turns a thrown value into copy fit
 * for a toast: it prefers a mapped code, then a plausibly-human `Error.message`,
 * then the caller's fallback. Route every error toast through it so a new code
 * shows the fallback instead of raw text - and add a line here when you want
 * that code to read nicely.
 */

// Codes are shared across the box backend and the control plane; a handful mean
// the same thing on both sides (e.g. `unauthorized`, `network`). One map keeps
// the copy consistent no matter which layer threw.
const ERROR_COPY: Record<string, string> = {
  // --- Connectivity between the box, the hs.direct broker, and the CP --------
  broker_unreachable: "Couldn't reach the connection service. Try again in a moment.",
  control_plane_unreachable: "Couldn't reach HearthShelf. Try again in a moment.",
  reachability_check_failed: "The connection check couldn't finish. Try again in a moment.",
  status_check_failed: "Couldn't check the connection status. Try again in a moment.",
  verify_failed: "Couldn't verify with HearthShelf. Try again in a moment.",
  probe_failed: "Couldn't reach your server from the outside. Check that its port is open.",
  network: 'Network error. Check your connection and try again.',
  abs_unreachable: "Couldn't reach your server. Make sure it's running and try again.",
  abs_list_failed: 'Your server returned an error. Try again in a moment.',
  abs_rejected: 'Your server rejected the change. Try again in a moment.',

  // --- Auth / session --------------------------------------------------------
  unauthorized: "You're not signed in. Sign in and try again.",
  no_token: "You're not signed in to this server. Reconnect and try again.",
  invalid_token: "That sign-in couldn't be verified. Sign in again and retry.",
  invalid_grant: 'Your session could not be verified. Sign in again and retry.',
  email_unverified: 'Verify your email address before continuing.',
  forbidden: "You don't have permission to do that.",

  // --- Pairing / connect -----------------------------------------------------
  not_paired: 'This server must be connected to HearthShelf first.',
  already_paired: 'This server is already connected to HearthShelf.',
  connect_failed: "Couldn't connect to HearthShelf. Try again in a moment.",
  pairing_start_failed: "Couldn't start connecting. Try again in a moment.",
  invalid_code: "That code isn't valid. Double-check it and try again.",
  code_required: 'Enter the connection code to continue.',
  code_already_used: 'That code has already been used. Start over to get a new one.',
  code_expired: 'That code expired. Start over to get a new one.',
  rate_limited: "You've tried too many times. Wait a bit and try again.",

  // --- Server address / hs.direct --------------------------------------------
  public_url_required: 'Set your server’s public web address first.',
  public_url_invalid: "That web address doesn't look right. Check it and try again.",
  public_url_not_reachable: "We couldn't reach that web address from the outside.",
  address_setup_failed: "Couldn't set up your server's web address. Try again in a moment.",
  address_update_failed: "Couldn't update your server's web address. Try again in a moment.",
  hsdirect_not_configured: 'A free HearthShelf web address isn’t set up for this server.',

  // --- Connection secret recovery --------------------------------------------
  server_secret_required: 'Paste the connection secret to continue.',
  bad_server_secret: "That connection secret didn't match. Check it and try again.",

  // --- Service account credential health -------------------------------------
  no_service_token: 'No service account is set up on this server yet.',
  mint_failed: "Couldn't create a service key. Try again in a moment.",
  bad_service_password: "That service account password didn't work.",
  token_not_admin: "That token isn't an admin/root token.",
  missing_input: 'Fill in the required fields and try again.',

  // --- Invites ---------------------------------------------------------------
  invalid_email: "That email address doesn't look right.",
  invalid_to: "That email address doesn't look right.",
  invite_not_found: "That invite couldn't be found. It may have been used or expired.",
  not_linked: "You're not linked to this server.",
  server_unknown: "That server couldn't be found.",

  // --- Email relay -----------------------------------------------------------
  quota_exceeded: "You've reached this month's email limit for this server.",
  send_failed: "The email couldn't be sent. Try again in a moment.",
  subject_required: 'Add a subject before sending.',
  body_required: 'Add a message before sending.',

  // --- Account switcher (device-remembered accounts) -------------------------
  pin_required: 'Enter your PIN to continue.',
  bad_pin: "That PIN wasn't right. Try again.",
  locked_out: 'Too many wrong PINs. Sign in with your password to continue.',
  unknown_handle: "That saved account isn't available anymore.",

  // --- Account deletion ------------------------------------------------------
  clerk_delete_failed:
    'Your HearthShelf data was removed, but your login couldn’t be deleted. Contact support to finish.',

  // --- Admin -----------------------------------------------------------------
  cannot_remove_self: "You can't remove yourself.",
  cannot_remove_last_admin: "You can't remove the last admin.",
  no_version: 'Pick a version first.',

  // --- Generic request problems ----------------------------------------------
  invalid_body: 'Something in that request wasn’t right. Try again.',
  bad_body: 'Something in that request wasn’t right. Try again.',
  bad_request: 'Something in that request wasn’t right. Try again.',
  invalid_payload: 'Something in that request wasn’t right. Try again.',
  name_too_short: 'That name is too short.',
  grant_required: 'Your session could not be verified. Sign in again and retry.',
  not_found: "That couldn't be found.",
  not_implemented: "That isn't available yet.",
  server_error: 'Something went wrong on our end. Try again in a moment.',
}

/**
 * A code is "raw" if it looks like an internal token rather than a sentence:
 * lower_snake_case, `http_500`, or `abs_list_failed`. We never want one of these
 * shown to a user, so an unmapped raw code falls through to the caller's
 * fallback instead of being displayed verbatim.
 */
function looksLikeRawCode(s: string): boolean {
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(s)
}

/**
 * Turn any thrown value into a user-facing message.
 *
 * Order: a mapped known code wins; then an `http_<n>` status maps to a generic
 * line; then a message that already reads like a sentence is passed through;
 * otherwise the caller's fallback. This means a brand-new backend code shows the
 * fallback (never the raw token) until it's given copy here.
 */
export function friendlyError(err: unknown, fallback = 'Something went wrong'): string {
  const raw = err instanceof Error && err.message ? err.message.trim() : ''
  if (!raw) return fallback
  if (ERROR_COPY[raw]) return ERROR_COPY[raw]
  if (/^http_\d{3}$/.test(raw)) return fallback
  // Anything still shaped like an internal code is not fit to show.
  if (looksLikeRawCode(raw)) return fallback
  return raw
}
