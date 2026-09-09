/**
 * Better Auth configuration - the whole identity surface for HearthShelf.
 *
 * Runs as its own Worker at auth.hearthshelf.com, isolated from the control
 * plane on purpose: this is the ONLY component that holds credential material
 * (password hashes, passkey public keys, 2FA secrets), and it holds neither the
 * control plane's grant-signing key nor any ABS credential. Compromise here is
 * bad, but it cannot forge a grant a self-hosted box would honour.
 *
 * Sign-in methods, and why there are several:
 *   - passkeys      - the primary method we actually want people using
 *   - social        - Google / Apple / Discord, carried over from Clerk
 *   - magic link    - fallback that needs no password and no authenticator
 *   - email OTP     - fallback for clients where a link round-trip is awkward
 *   - password      - kept only because two migrated accounts have one
 *   - TOTP + backup - second factor over any of the above
 *
 * Magic link and OTP depend on email delivery, so they fail together if Resend
 * is down; passkeys and social do not. That redundancy is the point.
 *
 * MIGRATION NOTE. `user.id` is seeded with each migrated account's ORIGINAL
 * Clerk user id. That id is the `sub` of every grant the control plane mints
 * and the primary key of per-user rows on every self-hosted box
 * (hosted_user_keys.cp_subject, app_installations.cp_subject). Boxes are
 * machines we do not operate and cannot coordinate a migration across, so the
 * id is effectively permanent. Never let Better Auth generate a fresh id for a
 * migrated account.
 */
import { betterAuth } from 'better-auth'
import { D1Dialect } from 'kysely-d1'
import { bearer, emailOTP, magicLink, twoFactor, username } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { expo } from '@better-auth/expo'
import { getAppleClientSecret } from './appleSecret'
import { sendMail, templates } from './email'
import type { Env } from './types'

function trustedOrigins(env: Env): string[] {
  return (env.TRUSTED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

/**
 * Origins allowed as OAuth/callback targets.
 *
 * The mobile app's deep-link scheme has to be trusted or every social sign-in
 * and magic link from the phone is rejected as an open-redirect attempt - the
 * callback lands on `hearthshelf://`, not an https origin. Kept separate from
 * the CORS allowlist in index.ts, which must stay https-only: a custom scheme
 * is not a browser origin and would be meaningless there.
 */
function allTrustedOrigins(env: Env): string[] {
  return [...trustedOrigins(env), `${env.APP_SCHEME || 'hearthshelf'}://`]
}

/**
 * Build the auth instance for a request.
 *
 * Constructed per-request rather than once at module scope because the D1
 * binding lives on `env`, which Workers hand us per invocation.
 */
export async function createAuth(env: Env) {
  // Minted per request from the .p8 when no pre-signed secret is set, so there
  // is no six-month rotation to remember. See ./appleSecret.ts.
  const appleClientSecret = await getAppleClientSecret(env)

  const mail = (to: string, subject: string, text: string) =>
    sendMail({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, to, subject, text })

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: allTrustedOrigins(env),

    database: { dialect: new D1Dialect({ database: env.AUTH_DB }), type: 'sqlite' },

    advanced: {
      // The session cookie has to be readable by the app, which lives on a
      // DIFFERENT SUBDOMAIN (app.hearthshelf.com) from this service
      // (auth.hearthshelf.com). Without a Domain attribute the browser scopes
      // the cookie to the auth host alone, so the app sees no session and
      // bounces every signed-in user straight back to the sign-in page - a
      // sign-in that genuinely succeeded looks like it silently failed.
      //
      // COOKIE_DOMAIN is the registrable parent both hosts share. It must stay
      // a parent of every origin in TRUSTED_ORIGINS.
      crossSubDomainCookies: {
        enabled: true,
        domain: env.COOKIE_DOMAIN || '.hearthshelf.com',
      },

      database: {
        // D1 refuses the sqlite_master introspection Better Auth uses to
        // self-check the schema on startup - it comes back SQLITE_AUTH, and the
        // failure is fatal, so every request 500s. Our schema is generated from
        // this exact plugin set and applied as a migration (see
        // migrations/0001_better_auth.sql), so the check has nothing to tell us
        // that the migration does not already guarantee.
        validateSchema: false,
      },
    },

    // Kept for the two migrated accounts that have a password. New accounts are
    // steered to passkeys; nothing in the UI needs to offer this.
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await mail(user.email, 'Reset your HearthShelf password', templates.magicLink(url))
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await mail(user.email, 'Confirm your email for HearthShelf', templates.magicLink(url))
      },
    },

    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : {}),
      // Apple MUST stay on the same developer team as the Clerk setup. Apple's
      // `sub` and its Private Relay addresses are issued per team, so a new team
      // would hand us a different subject for the same human and orphan the
      // seeded link for every relay user.
      ...(env.APPLE_CLIENT_ID && appleClientSecret
        ? { apple: { clientId: env.APPLE_CLIENT_ID, clientSecret: appleClientSecret } }
        : {}),
      ...(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET
        ? { discord: { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET } }
        : {}),
    },

    // Link a new sign-in method to the EXISTING account when the provider
    // asserts an email we already hold verified. This is what lets a migrated
    // user arrive via Google and land on their seeded row instead of creating a
    // duplicate. Only verified emails are trusted, or this would be an
    // account-takeover path.
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google', 'apple', 'discord'],
      },
    },

    plugins: [
      // Must come first: it rewrites cookies into a form the native client can
      // store, and adds the deep-link handling the other plugins' callbacks use.
      expo(),

      passkey({
        // Bound to the registrable domain the user sees, not this Worker's host.
        // A passkey is tied to its RP ID permanently and cannot be re-scoped.
        rpID: env.PASSKEY_RP_ID,
        rpName: env.PASSKEY_RP_NAME,
        origin: trustedOrigins(env),
      }),

      twoFactor({
        issuer: 'HearthShelf',
        otpOptions: {
          sendOTP: async ({ user, otp }) => {
            await mail(user.email, 'Your HearthShelf verification code', templates.otp(otp, 'sign-in'))
          },
        },
      }),

      emailOTP({
        sendVerificationOTP: async ({ email, otp, type }) => {
          await mail(email, 'Your HearthShelf code', templates.otp(otp, type))
        },
      }),

      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await mail(email, 'Sign in to HearthShelf', templates.magicLink(url))
        },
      }),

      // Usernames are display identity here, not a credential - people sign in
      // with a passkey, a provider, or their email. Exposing them as editable is
      // what lets someone fix a name a provider chose for them.
      username(),

      // Lets non-browser clients (the mobile app, the MCP server's callback)
      // present the session as `Authorization: Bearer` instead of a cookie.
      bearer(),
    ],
  })
}

export type Auth = Awaited<ReturnType<typeof createAuth>>
