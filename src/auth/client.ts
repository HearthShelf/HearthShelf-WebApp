/**
 * HearthShelf auth client (Better Auth) for the web app.
 *
 * Talks to the auth service at VITE_AUTH_SERVICE_URL. Everything that signs
 * someone in lives here: passkeys, Google / Apple / Discord, magic links,
 * email OTP, and TOTP two-factor.
 *
 * MULTI-SESSION is what makes the account switcher work. The browser can hold
 * several signed-in accounts at once and switch between them locally, which
 * replaces the previous provider's paid multi-session tier and the sign-in
 * ticket dance we built to avoid paying for it (mint a single-use ticket for
 * the target account, redeem it, replace the one session we were allowed). The
 * new shape is strictly better: switching is instant and needs no round trip.
 *
 * One consequence worth being deliberate about: a PIN on a remembered account
 * used to be enforced by the SERVER, because minting the ticket was a server
 * call that could refuse. With multi-session the sessions are already in the
 * browser, so a PIN gate is local UI. It still stops a family member tapping
 * into the wrong account; it is not a defence against someone with the device
 * and a debugger.
 *
 * `user.id` is the stable account id: the `sub` of every grant the control
 * plane mints, and the per-user primary key on every self-hosted server. For
 * accounts carried over from the previous provider it is that provider's
 * original id, seeded deliberately - never treat it as regenerable.
 */
import { createAuthClient } from 'better-auth/react'
import { passkeyClient } from '@better-auth/passkey/client'
import {
  emailOTPClient,
  magicLinkClient,
  multiSessionClient,
  twoFactorClient,
  usernameClient,
} from 'better-auth/client/plugins'

const AUTH_SERVICE_URL =
  (import.meta.env.VITE_AUTH_SERVICE_URL as string | undefined) ?? 'https://auth.hearthshelf.com'

export const authClient = createAuthClient({
  baseURL: AUTH_SERVICE_URL,
  plugins: [
    passkeyClient(),
    twoFactorClient(),
    emailOTPClient(),
    magicLinkClient(),
    usernameClient(),
    // Holds several signed-in accounts at once; see the module doc.
    multiSessionClient(),
  ],
})

export const { useSession, signIn, signUp, signOut, passkey, twoFactor, multiSession } = authClient
