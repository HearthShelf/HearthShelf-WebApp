# hearthshelf-auth

Isolated Cloudflare Worker running [Better Auth](https://better-auth.com) at
`auth.hearthshelf.com`. It owns HearthShelf's account identity: passkeys,
social sign-in, magic links, email OTP, and TOTP two-factor.

## Why it is its own Worker

It is the only component that holds credential material - password hashes,
passkey public keys, 2FA secrets. It holds **neither** the control plane's
grant-signing key **nor** any AudiobookShelf credential, so compromising it
cannot forge a grant a self-hosted box would honour. Same isolation rationale
as `log-collector/`.

## Sign-in methods

Passkeys are the method we want people using. Social (Google / Apple / Discord)
carries over from the previous provider. Magic link and email OTP are fallbacks
that need no password and no authenticator app. Password sign-in exists only
because two migrated accounts had one.

Magic link and OTP both depend on email, so they fail together if delivery is
down - passkeys and social do not. That redundancy is deliberate.

## The account ids are not ours to regenerate

`user.id` holds each migrated account's **original Clerk user id**. That id is
the `sub` of every grant the control plane mints and the primary key of per-user
rows on every self-hosted box (`hosted_user_keys.cp_subject`,
`app_installations.cp_subject`). Those are machines we do not operate and cannot
migrate on our schedule, so the id is effectively permanent.

`scripts/seed-legacy.mjs` writes those ids verbatim, along with the OAuth
subjects we already know, so a returning user's first sign-in **attaches** to
their existing account instead of creating a duplicate. For Apple Private Relay
users this is the only mechanism that works at all - their relay address is
issued per developer team, so they cannot be matched by email.

## Setup

```bash
wrangler d1 create hearthshelf-auth      # paste the id into wrangler.toml
npm run db:migrate:remote
node scripts/seed-legacy.mjs --dry-run   # inspect first
npm run seed:remote
```

Secrets: `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, and the Google / Apple /
Discord client id+secret pairs.

**Apple must stay on the same developer team as the Clerk setup.** Apple's
`sub` and its Private Relay addresses are issued per team; a different team
returns a different subject for the same person and orphans every seeded relay
user.

`PASSKEY_RP_ID` must be the registrable domain (`hearthshelf.com`), not this
Worker's hostname. A passkey is bound to its RP ID permanently - scoping it to
`auth.hearthshelf.com` would make every credential unusable from the app, with
no migration path.
