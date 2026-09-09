/**
 * The app's view of "who is signed in", in the shape components want.
 *
 * `useSession()` returns `{ data, isPending }`, but nearly every component
 * wants the same three things - is auth settled, is someone signed in, and who
 * are they. Wrapping it once keeps components from each re-deriving that (and
 * drifting in how they treat the pending state).
 *
 * `user.id` is the stable account id: the `sub` of every grant the control
 * plane mints, and the per-user primary key on every self-hosted server. For
 * accounts carried over from the previous identity provider it is that
 * provider's original id, seeded on purpose - so it is NOT regenerable.
 */
import { useCallback } from 'react'
import { authClient, useSession } from './client'
import { clearBearerToken } from './bearerToken'

export interface AuthUser {
  id: string
  email: string
  /** Full display name, when the account has one. */
  name: string
  /** Display username, when the account has one set. */
  username?: string
  /** Profile photo URL from the sign-in provider, when there is one. */
  imageUrl?: string
  /** Account creation time, for "member since". */
  createdAt?: Date
  /** Whether authenticator-based two-factor protection is enabled. */
  twoFactorEnabled?: boolean

  // Aliases matching the previous provider's user shape, so the components that
  // render a name or email did not all need rewriting for a field rename. They
  // are derived, never separate state.
  /** Alias of `name`. */
  fullName: string
  /** First word of `name`, for greetings. Empty when there is no name. */
  firstName: string
  /** Shaped like the old provider's nested email, which several views read. */
  primaryEmailAddress: { emailAddress: string } | null
}

export function useAuth(): {
  /** False while the session is still resolving. */
  isLoaded: boolean
  /** True once a session is confirmed. */
  isSignedIn: boolean
  user: AuthUser | null
  signOut: (opts?: { redirectUrl?: string }) => Promise<void>
} {
  const { data: session, isPending } = useSession()

  const signOut = useCallback(async (opts?: { redirectUrl?: string }) => {
    try {
      await authClient.signOut()
    } finally {
      clearBearerToken()
      // Navigate after the sign-out settles either way: if the service is
      // unreachable the local session is still gone, and stranding the user on
      // an authenticated screen would be worse than a redirect.
      if (opts?.redirectUrl) window.location.href = opts.redirectUrl
    }
  }, [])

  const raw = session?.user
  const name = raw?.name ?? ''
  const email = raw?.email ?? ''
  const legacyUsername = raw as { username?: string; displayUsername?: string } | undefined
  const user: AuthUser | null = raw
    ? {
        id: raw.id,
        email,
        name,
        // The human-facing account name is canonical. The username plugin's
        // normalized handle remains a legacy fallback, not a second profile.
        username: name || legacyUsername?.displayUsername || legacyUsername?.username || undefined,
        imageUrl: raw.image ?? undefined,
        createdAt: raw.createdAt ? new Date(raw.createdAt) : undefined,
        twoFactorEnabled: (raw as { twoFactorEnabled?: boolean }).twoFactorEnabled ?? undefined,
        fullName: name,
        firstName: name.split(' ')[0] ?? '',
        primaryEmailAddress: email ? { emailAddress: email } : null,
      }
    : null

  return { isLoaded: !isPending, isSignedIn: !!session, user, signOut }
}

/** Matches the previous provider's `useUser()` shape for components that only
 *  need the user object. */
export function useUser(): { user: AuthUser | null; isLoaded: boolean } {
  const { user, isLoaded } = useAuth()
  return { user, isLoaded }
}
