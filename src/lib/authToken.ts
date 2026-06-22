/**
 * Auth token seam.
 *
 * The control plane authenticates requests with the user's Clerk session JWT.
 * Clerk integration lands separately; until then this module is the single
 * place the API client asks for "the current bearer token". Wiring Clerk means
 * implementing getAuthToken() to return Clerk's session token (e.g. via
 * `window.Clerk.session.getToken()` or the React `useAuth().getToken()`),
 * nothing else in the API layer changes.
 */
type TokenGetter = () => Promise<string | null>

let getter: TokenGetter = async () => null

/** Register how the API client obtains the current bearer token (Clerk wires this). */
export function setAuthTokenGetter(fn: TokenGetter): void {
  getter = fn
}

export async function getAuthToken(): Promise<string | null> {
  return getter()
}
