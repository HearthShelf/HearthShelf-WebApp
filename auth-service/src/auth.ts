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
import { createAuthMiddleware } from 'better-auth/api'
import { D1Dialect } from 'kysely-d1'
import { bearer, emailOTP, magicLink, multiSession, twoFactor, username } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { expo } from '@better-auth/expo'
import { getAppleClientSecret } from './appleSecret'
import { sendMail, templates, type RenderedEmail, type SignInDetails } from './email'
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

function deviceName(request?: Request): string | undefined {
  const ua = request?.headers.get('user-agent') || ''
  if (!ua) return undefined
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser'
  const platform = /iPhone|iPad/.test(ua)
    ? 'iPhone or iPad'
    : /Android/.test(ua)
      ? 'Android device'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux'
            : ''
  return platform ? `${browser} on ${platform}` : browser
}

function signInDetails(request?: Request): SignInDetails {
  const cf = request?.cf as Record<string, unknown> | undefined
  const location = [cf?.city, cf?.region, cf?.country]
    .filter((value): value is string => typeof value === 'string' && Boolean(value))
    .join(', ')
  return {
    device: deviceName(request),
    ...(location ? { location } : {}),
    ip: request?.headers.get('cf-connecting-ip') || undefined,
    time:
      new Date().toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }) + ' UTC',
  }
}

/**
 * Build the auth instance for a request.
 *
 * Constructed per-request rather than once at module scope because the D1
 * binding lives on `env`, which Workers hand us per invocation.
 */
/**
 * Force a magic link's post-verification redirect onto a web origin.
 *
 * Returns the url unchanged when the callback is already http(s) - which is
 * every current client - so this only catches a stale build or a mistake.
 */
function webSafeCallback(url: string, appOrigin: string): string {
  try {
    const parsed = new URL(url)
    const cb = parsed.searchParams.get('callbackURL')
    if (!cb) return url
    if (/^https?:\/\//i.test(cb)) return url
    parsed.searchParams.set('callbackURL', appOrigin)
    return parsed.toString()
  } catch {
    // An unparseable url is not something to guess at; send it as-is.
    return url
  }
}

export async function createAuth(env: Env) {
  // Minted per request from the .p8 when no pre-signed secret is set, so there
  // is no six-month rotation to remember. See ./appleSecret.ts.
  const appleClientSecret = await getAppleClientSecret(env)

  // Every Google client id we will accept as an id-token audience. The web id
  // leads: it is the one the browser redirect flow authorizes with, and Better
  // Auth reads the head of the array for that. The extras exist only so a token
  // minted by the OS account picker (whose `aud` is the Android or iOS client
  // id) can pass verification.
  const googleClientIds = [env.GOOGLE_CLIENT_ID, ...(env.GOOGLE_NATIVE_CLIENT_IDS || '').split(',')]
    .map((id) => id?.trim())
    .filter((id): id is string => !!id)
    // A duplicate audience is harmless but makes the config confusing to read.
    .filter((id, i, all) => all.indexOf(id) === i)

  const mail = (to: string, email: RenderedEmail) =>
    sendMail({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, to, ...email })
  const appOrigin = trustedOrigins(env)[0] || env.BETTER_AUTH_URL
  const securityUrl = `${appOrigin}/account/account`

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

      // SameSite=None, because the app sets these cookies through a CROSS-SITE
      // fetch: the sign-in POST goes from app.hearthshelf.com to this service,
      // and a browser silently DISCARDS a SameSite=Lax cookie arriving on a
      // cross-site subresource request. The OAuth state cookie is the casualty
      // - it never gets stored, so when the provider redirects back the state
      // check fails with "State not persisted correctly" and the user is
      // returned to sign-in having done everything right.
      //
      // Safe here: the cookies stay Secure and HttpOnly, and the origins that
      // may talk to this service are pinned in TRUSTED_ORIGINS rather than
      // reflected, so None widens where a cookie may be SET, not who may use it.
      defaultCookieAttributes: {
        sameSite: 'none',
        secure: true,
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
        await mail(user.email, templates.resetPassword(url))
      },
      onPasswordReset: async ({ user }) => {
        // The password operation already succeeded. A mail outage must not turn
        // that success into an error response or tempt the user to retry it.
        await mail(user.email, templates.passwordChanged(securityUrl)).catch(() => {})
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await mail(user.email, templates.verificationLink(url))
      },
    },

    databaseHooks: {
      session: {
        create: {
          after: async (session, context) => {
            // A successful session is the reliable cross-provider sign-in edge:
            // passkeys, social, magic links and passwords all pass through it.
            // The alert is best-effort so delivery can never break the sign-in.
            try {
              const user = await env.AUTH_DB.prepare('SELECT email FROM user WHERE id = ? LIMIT 1')
                .bind(session.userId)
                .first<{ email: string }>()
              if (user?.email) {
                await mail(
                  user.email,
                  templates.newSignIn(securityUrl, signInDetails(context?.request)),
                )
              }
            } catch {
              // Security mail is secondary to preserving the completed sign-in.
            }
          },
        },
      },
    },

    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              // An ARRAY, not a single id, because the phone signs in natively.
              // The OS account picker mints its id token against the platform
              // client (Android / iOS), so the token's `aud` is that client id
              // and not the web one - and audience verification is exact, so a
              // lone web id rejects every native sign-in. The web id stays FIRST
              // because it is also the id the browser redirect flow authorizes
              // with (getPrimaryClientId takes the head of the array); the rest
              // only widen what may be presented for verification.
              clientId: googleClientIds,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
      // Apple MUST stay on the same developer team as the Clerk setup. Apple's
      // `sub` and its Private Relay addresses are issued per team, so a new team
      // would hand us a different subject for the same human and orphan the
      // seeded link for every relay user.
      ...(env.APPLE_CLIENT_ID && appleClientSecret
        ? {
            apple: {
              clientId: env.APPLE_CLIENT_ID,
              clientSecret: appleClientSecret,
              // Native "Sign in with Apple" issues a token addressed to the app
              // BUNDLE id, while the browser flow addresses the SERVICES id.
              // Accept both, or one of the two flows always fails verification.
              ...(env.APPLE_APP_BUNDLE_ID
                ? {
                    appBundleIdentifier: env.APPLE_APP_BUNDLE_ID,
                    audience: [env.APPLE_CLIENT_ID, env.APPLE_APP_BUNDLE_ID],
                  }
                : {}),
            },
          }
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

    // Hand the caller its own session token on every get-session, as the
    // `set-auth-token` header. The bearer plugin only stamps that header on
    // responses that SET a session cookie - i.e. the sign-in response - and a
    // social sign-in's "response" is a redirect the app never gets to read.
    // So an OAuth-established session had no way to obtain a bearer token for
    // the control plane (a different origin, which the HttpOnly cookie never
    // reaches): every control-plane call went out without one and 401'd, and a
    // freshly signed-in user saw an empty server list and "not signed in".
    // The value is the signed cookie the bearer plugin already accepts.
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/get-session') return
        const name = ctx.context.authCookies.sessionToken.name
        const value = ctx.getCookie(name)
        if (value) ctx.setHeader('set-auth-token', value)
      }),
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
        // Social- and passkey-only accounts have no password to re-enter.
        // Better Auth still requires one when a credential account exists.
        allowPasswordless: true,
        otpOptions: {
          sendOTP: async ({ user, otp }) => {
            await mail(user.email, templates.otp(otp, 'sign-in'))
          },
        },
      }),

      emailOTP({
        sendVerificationOTP: async ({ email, otp, type }) => {
          await mail(email, templates.otp(otp, type))
        },
      }),

      magicLink({
        sendMagicLink: async ({ email, url }) => {
          // Rewrite a custom-scheme callback to the web app before the link is
          // sent.
          //
          // A magic link is opened from a MAIL CLIENT, which may well be on a
          // different device than the one that asked for it - a laptop, say.
          // `hearthshelf://` resolves to nothing there, so the verify endpoint
          // 302s to a scheme the browser cannot follow and the page simply
          // never loads: no error, no content, nothing to report. An old mobile
          // build sent exactly that, and the only symptom was a dead link.
          //
          // The scheme stays trusted for OAuth, where the app IS the thing
          // being returned to - this rewrite is specific to email.
          await mail(email, templates.magicLink(webSafeCallback(url, appOrigin)))
        },
      }),

      // Usernames are display identity here, not a credential - people sign in
      // with a passkey, a provider, or their email. Exposing them as editable is
      // what lets someone fix a name a provider chose for them.
      username(),

      // Lets non-browser clients (the mobile app, the MCP server's callback)
      // present the session as `Authorization: Bearer` instead of a cookie.
      bearer(),

      // Holds several signed-in accounts in one browser, which is what the
      // shared-device account switcher runs on (see the SPA's
      // useAccountSwitch.ts). MUST stay paired with multiSessionClient() on the
      // clients: without it here the client calls /multi-session/* and gets a
      // 404, and the switcher silently cannot find any session to switch to.
      multiSession(),
    ],
  })
}

export type Auth = Awaited<ReturnType<typeof createAuth>>
