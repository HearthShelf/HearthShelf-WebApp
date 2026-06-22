# Architecture & Design Plan

The planning record for the HearthShelf hosted web app (`app.hearthshelf.com`):
a single front door, like `app.plex.tv`, that lets a user reach every
HearthShelf / AudiobookShelf (ABS) server they have access to from one URL,
after authenticating once.

This document captures **both the decisions and the reasoning behind them**. If
you are an agent or contributor picking this up later: read the "Spirit of the
rules" section first. The constraints here are not arbitrary - each one exists to
protect a property (legal independence, security, ease of use) that is easy to
break by accident if you only follow the letter and miss the intent.

---

## Spirit of the rules (read this first)

These are the load-bearing intentions. When a future decision is ambiguous,
decide in favor of these.

1. **The arm's-length boundary is the whole ballgame, legally.** This repo is
   proprietary and closed-source. It can only stay that way because it never
   touches the AGPL-licensed HearthShelf source - it is a *client* of that
   server's public HTTP/Socket API, no different from any third-party client.
   The moment this codebase imports, vendors, links against, or copies AGPL
   source, AGPL's network clause (Section 13) would force this hosted app open.
   Knowledge crosses the boundary as **API contracts only** - request/response
   shapes - never as shared code. You may reimplement a behavior that looks
   identical; you may not copy the file that does it. See `AGENTS.md`.

2. **The user authenticates once and never sees another auth screen.** This is
   the Plex promise and the product's reason to exist. Every auth decision is
   measured against it. A second auth screen is a *fallback for a degraded
   setup*, never the default path, never encouraged.

3. **Easy and secure are both required, not traded off.** The default path
   should be the *most* secure one (federated SSO, no stored passwords) *and*
   the easiest one (the gateway configures the server for the admin). When they
   appear to conflict, look harder - usually the design that removes a stored
   secret also removes a setup step.

4. **The user's data is per-user and sacred.** ABS scopes everything
   (progress, bookmarks, permissions, library access) to the individual ABS
   user. There is no shared identity. Any design that would let one person see
   another's library as the wrong identity is wrong, full stop. This is why a
   single shared ABS credential was rejected early.

5. **Secrets at rest are a footprint to minimize, not a vault to build.** The
   default path stores zero usable ABS passwords. Where a secret must exist
   (the fallback), it is transient and scoped to one self-hosted server, never
   centralized into a honeypot on the control plane.

6. **Servers may be unreachable from the internet; the control plane may be
   down.** A self-hosted ABS often sits behind a firewall, exposed only via its
   HS gateway. Trust verification must work **offline** - an HS server must be
   able to validate an incoming request without phoning home. A control-plane
   outage must not lock a user out of their own server.

7. **Web and mobile are the same math.** A future native mobile app is just
   another client doing exactly what the browser does. Keep the control-plane
   API and token model plain (REST + bearer, no web-only cookie assumptions) so
   mobile reuses it verbatim.

8. **HearthShelf is a UI, not a content source.** Keep the positioning
   guardrails from `AGENTS.md`. No "free books" framings; acquisition
   integrations are neutral, opt-in plumbing; keep the responsibility
   disclaimer on user-facing surfaces.

---

## The cast of repositories

| Repo | License | Role |
|---|---|---|
| `HearthShelf-WebApp` (this) | **Proprietary** | The hosted front door SPA + control plane. Talks to HS servers over their public API only. |
| `HearthShelf` | AGPL-3.0 | The self-hostable server: an SPA + a Node backend ("QuestGiver") that acts as an API **gateway** in front of an internal, unexposed ABS. This is where hosted-mode server code lives. |
| `audiobookshelf` (ABS) | AGPL-3.0 | The actual library server. Runs internal-only in Docker (`http://abs:13378`). HS proxies to it. Source mirror at `C:\code\audiobookshelf` for API reference. |
| `HearthShelf-Website` | AGPL (implied) | Marketing/docs site (VitePress, on Cloudflare Pages). |
| `HearthShelf-DesignSystem` | n/a (handoff bundle) | Claude Design token + component handoff. Not an npm package. |

**Key architectural fact:** `app.hs.com` talks to the **HS server (the
gateway)**, not to ABS directly. ABS stays unexposed behind HS. This is what
lets us build the auth bridge we need on the HS side, with ABS left on plain
username/password internally if the admin wants.

---

## Licensing (resolved)

- This repo stays **proprietary** by never importing AGPL source. Confirmed
  clean; the boundary in `AGENTS.md` is the enforcement.
- Server-side hosted-mode code (the OIDC provider bridge, pairing endpoints,
  the fallback token store) lives in the **AGPL `HearthShelf` repo**, not here.
  That is correct and intentional - it ships with the self-hostable server.
- Minor housekeeping for the open-source side (not blockers): add
  `"license": "AGPL-3.0"` to `HearthShelf` and `HearthShelf-Website`
  `package.json`, and a `LICENSE.md` to the Website and DesignSystem.

---

## Hosting (resolved): Cloudflare Pages + Workers + D1

- **SPA** -> Cloudflare **Pages** (the Website already deploys to CF Pages, so
  tooling is consistent).
- **Control plane** -> Cloudflare **Workers** + **D1** (edge SQLite; same mental
  model as HS's libSQL).
- **Cost:** effectively $0 until real traffic. Chosen over a GoDaddy VPS on
  price, performance, and ops burden.
- **Workers caveat we design around:** Workers do not hold long-lived
  WebSocket connections well. That is fine here because the live playback
  Socket.io connection is **browser -> HS server directly**, never through the
  Worker. The Worker only does control-plane work (auth brokering, the server
  registry, invite emails).

---

## Design system (resolved): reuse tokens, rebuild components

No new design system. Do exactly what the HS server did:

- **Copy the token CSS** (`colors_and_type.css`: ember coral `#e0654a`,
  cream/dark warm surfaces, Geist + Geist Mono + Libre Baskerville, the
  4px-cadence spacing scale, `--radius` 1rem) into the WebApp's global CSS.
- **Rebuild components locally** with shadcn + CVA. Do **not** ship the
  prototype UMD bundle (`_ds_bundle.js`) in production - it is a handoff
  artifact.
- The WebApp's *difference* from single-server HS is its **shell**: a
  server-switcher and cross-server library aggregation layer. Same visual
  language, multi-server information architecture.

Token source: `C:\code\HearthShelf-DesignSystem\project\_ds\abs-revamp-38af2d81-b540-46ff-a339-0cc1eb78b74a\colors_and_type.css`
Component reference: `C:\code\HearthShelf\src\components\ui\*.tsx`

---

## Proposed tech stack

Mirror the HS server so patterns transfer (but never the source):

- React 19 + TypeScript, Vite
- Tailwind v4, shadcn-style components, CVA, Lucide icons
- Zustand (client state), TanStack Query (server state)
- React Router v7
- Clerk (front-door identity; has native web + mobile SDKs)
- Cloudflare Workers + D1 for the control plane (Hono is a reasonable Worker
  framework, TBD at build time)

---

## Identity & auth (the heart of the design)

### The model in one paragraph

The user signs into **Clerk** once for `app.hs.com`. The **control plane**
knows which HS servers that Clerk identity is linked to. For each linked server,
the client obtains a short-lived, signed **grant assertion** and talks to that
HS server **directly**. The HS server verifies the assertion **offline** and,
in the default path, federates the user into ABS via **OIDC** (HS acting as the
OIDC provider, ABS configured to trust it). ABS scopes data to the matched
per-user account. No second auth screen; no centrally stored ABS passwords.

```
                  sign in once
   You (browser) ----------------> Clerk  (identity for app.hs.com)
        |
        | "which servers am I linked to?"
        v
   CF Worker (control plane)  --  D1: clerk_user_id -> [ {server, grant} ... ]
        |
        | short-lived SIGNED assertion:
        | "Clerk user X, verified email, linked to server Y, exp 5m"
        v
   Your HS server (HS_MODE=hosted)
        |  - verifies assertion offline with pinned control-plane public key
        |  - federates user into ABS via OIDC (default) -> per-user ABS session
        |  - ABS stays internal, on un/pw, never exposed
        +-- ABS (internal only)
```

### Tiered auth: default vs fallback

ABS supports `local` (username/password) **and** `openid` simultaneously. We
lean into that.

| Path | ABS config | User experience | Secret at rest? |
|---|---|---|---|
| **Default (encouraged)** | OIDC on, HS as the one trusted SSO provider | Clerk login -> straight in, no second screen | **None** - federated, no stored password |
| **Fallback (power user / degraded)** | `local` only | **One** extra auth screen at link time | HS stores that one user's ABS token, encrypted, on that server only |

We do **not** open ABS's OIDC to arbitrary external providers - it is our SSO
or nothing on that channel. The fallback is allowed but never the default and
never encouraged.

### Why this is both easiest and most secure

The whole ABS OIDC config is settable in **one authenticated API call** the
gateway makes for the admin, so the admin never touches ABS's OIDC screen. And
because it is federated, the default path stores no ABS password anywhere. Easy
and secure are the *same* path here, not a trade-off.

---

## Trust: how an HS server trusts an incoming request (offline)

This is the security core. An HS server must validate that a request truly
represents a Clerk-authenticated user who is actually linked to *that* server -
**without calling the control plane** (firewalled servers; outage tolerance).

**Mechanism: pinned public key ("cert") + JWKS cache + short-TTL signed
assertions.**

1. **Pairing bootstraps trust.** When a server is linked (see pairing below),
   the HS server receives and **pins the control plane's public verification
   key**. This is the "cert."
2. **Every grant is a short-lived signed JWT.** The control plane signs an
   assertion: *"Clerk user X, verified email `alice@...`, linked to server Y,
   expires in ~5 minutes."* The HS server verifies the signature locally with
   the pinned key. **No callback needed** -> works behind a firewall, survives
   a control-plane outage.
3. **Caching.** HS caches the control plane's JWKS and refreshes periodically.
   This is what keeps verification offline between refreshes.
4. **Revocation = short TTL.** Un-inviting a user or unlinking a server means
   the control plane stops re-issuing assertions; access dies within the TTL.
   No revocation list to sync. (An optional small denylist cache can give
   instant kill later if needed; short TTL is the simpler default.)

**Decision: one keypair per control plane**, not per server. All HS servers
trust the same `app.hs.com` signing key; the assertion's "linked to server Y"
claim is what scopes it. Simpler to rotate; build in key-rotation support from
the start. (Per-server keypairs would give more isolation at a large key-
management cost - rejected as the default.)

---

## Server linking: pairing code from HS setup

The "make it easy" core. During HS install/setup, the admin opts into
`app.hearthshelf.com`. HS surfaces a short **pairing code** (HS initiates,
like pairing a streaming device). The admin/user enters it once on
`app.hs.com`. Pairing:

- establishes the link record on **both** sides (control plane D1 **and** the
  HS server's own DB - it is an explicit, revocable grant in both places), and
- delivers the control plane's **public key** to the HS server (bootstrapping
  the trust model above).

ABS itself never needs OIDC configured by hand - **HS brokers it.**

---

## Tokens: HS mints, client holds, direct connection

- The HS server mints short-lived **per-user** access tokens after verifying
  the control-plane grant assertion. The **client holds** them (httpOnly /
  memory on web; secure keychain on mobile).
- The browser/app talks to the HS server **directly** with that token. The
  **control plane never holds ABS credentials** and is never a traffic
  bottleneck. Compromising the front door does not hand over libraries.
- This is why the control-plane API and token format stay plain and
  mobile-friendly (Spirit rule 7).

---

## Provisioning & invites (the Plex "invite by email" flow)

Goal: an admin invites someone by email; that person clicks, makes (or already
has) a Clerk account, and everything else just happens.

**We pre-provision the ABS user** rather than relying on ABS auto-register,
because it gives us control over the username (from Clerk) and a deliberate
password lifecycle. Verified against ABS 2.35.1 source and the live test
server; the password-set and username-change admin endpoints are confirmed
usable.

The flow:

```
Admin invites alice@email.com (in HS or app.hs.com)
   |
   |  Control plane sends the invite email   <-- WE own this; ABS has no invite/email
   v
Alice clicks -> creates / signs in to her Clerk account (app.hs.com)
   |
   |  Control plane pre-provisions her ABS user via POST /api/users
   |  with her email + a temp, secure password WE generate and hold transiently
   v
First connect to her library:
   - username: pulled from Clerk preferred username, set on the ABS account
   - OIDC SSO federates her in, matched by VERIFIED email
   - backup-password prompt (see below) resolves the temp password's fate
```

### The temp password lifecycle (deliberate, minimal footprint)

The temp password exists **only** between invite and first login - it satisfies
ABS's "username + password required" on user creation and lets us call
password-set APIs on her behalf. The user never sees it. On first connect we
ask: *"Want a backup password to log into this server directly (e.g. native ABS
apps)?"*

- **Yes** -> she sets one; we write it via the API and **immediately forget
  it**. ABS then holds the only copy. We never track what she chose.
- **No** -> we **destroy our temp-password record**. She is SSO-only; if she
  ever needs direct access, a server admin resets it.

Net result: **steady state holds zero usable ABS passwords on the control
plane.** (Spirit rule 5.)

### Email-match integrity (do not skip)

Matching is **by verified email**. ABS's OIDC match path requires
`email_verified !== false`. Clerk verifies emails by default. The HS OIDC
provider bridge **must pass `email_verified: true`** through to ABS, and the
invite must bind to the *verified* email - so nobody is ever linked to the
wrong identity.

---

## Confirmed ABS API surface (evidence)

Verified against `C:\code\audiobookshelf\server` (v2.35.1) and live
`books.jpdev.us`:

- **OIDC config is fully API-writable** in one admin call:
  `PATCH /api/auth-settings` (admin-only) sets `authActiveAuthMethods`,
  the issuer/auth/token/userinfo/jwks URLs, `authOpenIDClientID/Secret`, and
  crucially `authOpenIDMatchExistingBy: 'email'` and `authOpenIDAutoRegister`.
  Takes effect immediately. (ABS strips `openid` from active methods unless the
  full valid config is present.)
- **User creation:** `POST /api/users` (admin) requires `username` **and**
  `password`; `email` optional. No email-only creation, **no invite/pending
  concept** in ABS -> the control plane owns invites and invite email.
- **ABS email** sends ebook-to-device only; **no invitation emails** -> ours.
- **Live server** already reports `authMethods: ["local","openid"]` - OIDC is
  real and active there.
- The HS server already ships an `HS_MODE=hosted` **stub** and a DB keyed by
  `(server_id, user_id)` - the codebase was pre-shaped for this multi-server
  hosted mode. Hosted-mode resolution plugs into `server/lib/context.js`
  (currently throws `hosted_mode_not_implemented`).

---

## Work breakdown + status

Status as of the control-plane + hosted-mode build. `[x]` done & verified,
`[~]` partial/seam in place, `[ ]` not started. Server-side items live in the
**AGPL repo** (`C:\code\HearthShelf`, branch `hosted-mode`).

**Control plane (this repo, `control-plane/` - CF Worker + Hono + D1):**
- `[x]` D1 schema: servers, links (`clerk_user_id -> server`), pairing codes,
  signing keys. (`control-plane/migrations/0001_init.sql`)
- `[x]` Signing keypair (EdDSA) + JWKS endpoint; mint short-TTL grant
  assertions. (`src/lib/signing.ts`, `src/routes/well-known.ts`)
- `[x]` Pairing-code exchange: `/pairing/start` (server-to-server) +
  `/pairing/redeem` (Clerk). (`src/routes/pairing.ts`)
- `[x]` Linked-servers + grant API: `GET /servers`, `POST /servers/:id/grant`,
  `DELETE /servers/:id`. (`src/routes/servers.ts`)
- `[~]` Clerk verification: implemented against Clerk's JWKS
  (`src/lib/clerk.ts`); needs the real `CLERK_JWKS_URL` + a JWT template that
  emits verified `email`/`email_verified`. **(YOU: Clerk wiring.)**
- `[ ]` Invite issuance + invite email delivery (the Plex invite flow).
- `[ ]` Deploy: `wrangler d1 create`, real `database_id`, `wrangler secret put
  CP_SIGNING_JWK`, `wrangler deploy`. (See `control-plane/README.md`.)

**SPA (this repo, `src/`):**
- `[x]` Vite + React 19 + TS + Tailwind v4 scaffold; design tokens imported;
  base components + logo.
- `[x]` Front-door shell: server picker (loading/empty/error), per-server view.
- `[x]` Control-plane client + TanStack Query; auth-token seam
  (`src/lib/authToken.ts`) ready for Clerk.
- `[~]` Clerk provider + `setAuthTokenGetter` wiring. **(YOU: Clerk.)**
- `[ ]` Pairing UI ("Link a server" -> `useLinkServer()`).
- `[ ]` Per-server direct connection: redeem grant with HS, then HTTP +
  Socket.io straight to the HS server.

**HS server (AGPL repo `hosted-mode` branch - APPROVED, DCO-signed):**
- `[x]` `resolveHostedContext()` verifies the control-plane grant offline via
  JWKS, then resolves a per-user ABS credential.
  (`server/lib/hosted.js`, wired in `server/lib/context.js`)
- `[x]` Per-user ABS auth via **ABS API keys** (Option A, refined): match ABS
  user by verified email, mint a per-user API key with the admin token, cache
  it. No passwords stored. (`server/lib/hosted.js`)
- `[x]` Pairing + key pinning: `/hs/hosted/pair` calls the control plane,
  persists issuer/jwks/secret; JWKS cached by `jose`. (`server/routes/hosted.js`)
- `[x]` DB: `hosted_config` + `hosted_user_keys`. (`server/db.js`)
- `[ ]` HS-as-OIDC-provider bridge + `PATCH /api/auth-settings` to auto-config
  ABS OIDC. NOTE: the shipped implementation uses **API-key minting** instead
  of full OIDC federation - simpler, no ABS OIDC setup, and it stores no
  passwords. The OIDC bridge remains a future option for true SSO into ABS's
  own login page; revisit if/when needed.
- `[ ]` Pre-provision / invite flow (`POST /api/users`, username-from-Clerk,
  temp-password lifecycle) - pairs with control-plane invites above.
- `[ ]` Setup UI in the HS SPA to drive `/hs/hosted/pair` and show the code.

**Implementation note - API keys vs OIDC.** The plan described OIDC federation
as the default. During the build we verified ABS exposes per-user **API keys**
(`POST /api/api-keys`, bound to a userId, act as that user). That turned out to
be the cleaner path for the hosted control-plane model: it needs no ABS OIDC
configuration, stores no passwords, is revocable per user, and keeps ABS fully
internal. So hosted mode ships with API-key minting. OIDC-into-ABS stays a
viable future enhancement (e.g. if users want ABS's native login screen), not a
prerequisite. This honors Spirit rules 3 (easy+secure) and 5 (minimal secrets).

**Open items / to revisit:**
- Key-rotation procedure specifics (schema + JWKS-by-kid support exist).
- Optional instant-revocation denylist (short TTL is the default mechanism).
- Whether to add the OIDC bridge later for native-ABS-login SSO.

---

## Decisions log (quick reference)

| Concern | Decision |
|---|---|
| Licensing | Proprietary; arm's-length API client; server code in AGPL repo. |
| Design system | Reuse tokens, rebuild components locally. No new system. |
| Hosting | CF Pages (SPA) + Workers + D1 (control plane). |
| Front-door identity | Clerk (web + future mobile, identical math). |
| SSO into ABS (default) | HS as OIDC provider, federated from Clerk; ABS set via `PATCH /api/auth-settings`. |
| Fallback auth | ABS un/pw with one extra screen; HS stores that user's token encrypted. Not default. |
| Provisioning | Pre-provision ABS user (control username + password lifecycle), match by verified email. |
| Invites | Control plane sends invite email -> Clerk signup -> federated/provisioned ABS user. |
| Temp password | Transient; set-and-forget on opt-in, destroyed on opt-out. Zero stored passwords in steady state. |
| Server linking | Pairing code from HS setup; bootstraps the trust public key. |
| Tokens | HS mints short-lived per-user; client holds; direct browser/app <-> HS. |
| Trust | Pinned control-plane public key + JWKS cache + short-TTL signed assertions, verified offline. |
| Signing key scope | One keypair per control plane (not per server), with rotation support. |
| Socket.io | Direct browser <-> HS, never through the Worker. |
