/**
 * Provider-neutral session verification.
 *
 * The single seam between "some identity provider says who this is" and the
 * OAuth grant this Worker issues. Downstream, the authorize flow sees only an
 * `AuthIdentity` and seals it into the grant's encrypted props; nothing knows
 * which provider issued the session.
 *
 * Mirrors the control plane's lib/identity.ts deliberately. The two Workers do
 * not share code (separate deployments, separate dependency trees), so this is
 * a copy - but the CONTRACT must stay identical, because a user signs in at the
 * SPA and that same session token is what arrives here.
 *
 * Both providers are live at once ON PURPOSE. During cutover a browser may
 * still hold a valid Clerk session while the SPA has already shipped Better
 * Auth, so `verifyIdentity` tries the configured primary first and falls back
 * to the other. Once every session has rolled over, set AUTH_PROVIDER to
 * 'better-auth' and drop the Clerk secrets; the fallback then never fires.
 *
 * The `subject` returned here is ALWAYS the stable account id - for migrated
 * users, their original Clerk user id. See LegacyAccountSeed in
 * @hearthshelf/core for why re-keying it is not an option.
 */
// NOTE: these mirror AuthIdentity / IdentityProvider in @hearthshelf/core, but
// are declared locally on purpose. The control plane is a standalone Worker
// with no core dependency (see tsconfig - there is no path alias here), and
// pulling the submodule in just for two type aliases would couple the Worker's
// build to it. The shapes are small, stable, and asserted by the box contract;
// if they ever drift, grant verification fails loudly rather than silently.
export type IdentityProvider = 'clerk' | 'better-auth'

export interface AuthIdentity {
  /** Stable account id - the grant `sub`, and the per-user key on every box.
   *  Migrated accounts keep their original Clerk user id verbatim. */
  subject: string
  /** Alias of `subject`, kept so the existing call sites (and the
   *  `clerk_user_id` D1 columns they feed) read unchanged. The name is a
   *  historical artifact: the id is ours now, not Clerk's. */
  userId: string
  email: string
  emailVerified: boolean
  username: string
  provider: IdentityProvider
}
import { AuthError, verifyClerk } from './clerk'
import { verifyBetterAuth } from './betterAuth'
import type { Env } from '../types'

export { AuthError }

/** Which provider to try first. Defaults to Clerk until the cutover flips it. */
function primaryProvider(env: Env): IdentityProvider {
  return env.AUTH_PROVIDER === 'better-auth' ? 'better-auth' : 'clerk'
}

/** Is a provider configured well enough to be worth trying? */
function isConfigured(env: Env, provider: IdentityProvider): boolean {
  return provider === 'better-auth' ? !!env.BETTER_AUTH_URL : !!env.CLERK_JWKS_URL
}

async function verifyWith(
  env: Env,
  provider: IdentityProvider,
  token: string,
): Promise<AuthIdentity> {
  if (provider === 'better-auth') return verifyBetterAuth(env, token)
  const clerk = await verifyClerk(env, token)
  return {
    subject: clerk.userId,
    userId: clerk.userId,
    email: clerk.email,
    emailVerified: clerk.emailVerified,
    username: clerk.username,
    provider: 'clerk',
  }
}

/**
 * Verify a session token against whichever provider issued it.
 *
 * Throws AuthError if no configured provider accepts it. The error carries the
 * PRIMARY provider's failure, not the fallback's, because during cutover the
 * fallback failing is the expected case and its message would be noise.
 */
export async function verifyIdentity(env: Env, token: string): Promise<AuthIdentity> {
  const primary = primaryProvider(env)
  const secondary: IdentityProvider = primary === 'clerk' ? 'better-auth' : 'clerk'

  let primaryErr: unknown = null
  if (isConfigured(env, primary)) {
    try {
      return await verifyWith(env, primary, token)
    } catch (err) {
      primaryErr = err
    }
  }

  if (isConfigured(env, secondary)) {
    try {
      return await verifyWith(env, secondary, token)
    } catch {
      // Fall through - report the primary's failure below.
    }
  }

  if (primaryErr instanceof AuthError) throw primaryErr
  if (primaryErr) throw new AuthError(String((primaryErr as Error).message ?? primaryErr))
  throw new AuthError('no identity provider configured')
}
