# Hosted-mode OIDC federation — the secure design

Status: **design, pre-implementation.** This is the authoritative spec for how a
hosted `app.hearthshelf.com` user reaches the real library on a self-hosted
HearthShelf/ABS server. It supersedes the API-key-minting path that shipped in
the AGPL repo (see "What shipped vs. what we're building").

It is grounded in verified contracts, not memory:
- ABS OIDC contract verified against `C:\code\audiobookshelf` **v2.35.1**
  (field names, email-verified enforcement, callback flow, cross-origin token).
- Clerk-as-OIDC-provider verified against current Clerk docs (per-server OAuth
  clients via Backend API, unlimited on the free plan, PKCE + nonce).
- HS gateway + nginx routing verified against `C:\code\HearthShelf` (main).

---

## 1. The problem this solves

The front door (`app.hearthshelf.com`) must let a Clerk-authenticated user browse
and play their library on a self-hosted server, **without a second login** and
**without the control plane ever holding ABS credentials**.

The library itself (libraries, items, covers, audio streams, progress) lives in
ABS's native `/api/*`, `/s/*`, and Socket.io surfaces. nginx on the HS server
forwards those **straight to ABS** — the HS Node backend only owns `/hs/*`
(HearthShelf features). So the client needs a credential **ABS itself issues and
recognizes**. A control-plane grant JWT does not qualify; an ABS-native token
does.

OIDC federation is how we get an ABS-native token without a password: ABS trusts
our identity provider, the user logs in through it once, and ABS mints its own
session. This was the ratified design from day one; the API-key path was a
build-time shortcut that only ever worked for `/hs/*`.

---

## 2. The model in one paragraph

The user signs into **Clerk** once for `app.hearthshelf.com`. The **control
plane** knows which servers that identity is linked to (via pairing). Each linked
server's ABS is configured — by the control plane, during pairing — to trust a
**dedicated, per-server Clerk OAuth client** as its OIDC provider, matching users
by **verified email**. To open a server, the SPA sends the browser through that
server's **own** `/auth/openid` flow; ABS runs standard OIDC (PKCE + nonce)
against Clerk, matches the user by verified email, and mints an **ABS-native
access token**, which it hands back to the SPA in the callback redirect. The SPA
then calls that server's `/api/*` directly with that token. No second password
screen; no ABS password stored anywhere; the control plane is never in the data
path.

---

## 3. Why per-server confidential clients (the "most secure" decision)

The dominating security choice is **how the OIDC client credential is held.**

| Posture | Blast radius of a leaked secret | Browser sees secret? | Chosen |
|---|---|---|---|
| Public client (PKCE only, no secret) | n/a but weaker client auth | n/a | no |
| One shared confidential client, many redirect URIs | **all servers** | no | no |
| **Per-server confidential client, brokered** | **one server** | no | **yes** |

Per-server wins because:
- **Isolation.** Each server's ABS holds only *its own* `client_id`/`client_secret`.
  Compromising one self-hoster's ABS config exposes one client, not the fleet.
- **Clean revocation.** Unlinking a server = delete/revoke that one Clerk client.
  No shared-secret rotation across every server.
- **Pinned redirect_uri.** Each client allowlists exactly one redirect URI (that
  server's `/auth/openid/callback`), shrinking open-redirect surface to nil.
- **Secret never touches the browser.** The control plane provisions the client
  and writes the secret into ABS server-side (`PATCH /api/auth-settings`). The
  SPA only ever drives the standard browser OIDC dance.

Feasibility (verified): Clerk creates OAuth clients via
`POST https://api.clerk.com/v1/oauth_applications` (Backend API, secret-key
auth), **OAuth applications are unlimited on the free plan**, and per-client
secret rotation + revocation are supported. The one open confirmation item:
get written confirmation from Clerk that "Clerk-as-OAuth-provider" is included on
the free tier (docs imply yes; not explicit). Tracked in §9.

---

## 4. The flows

### 4.1 Pairing (once per server, admin) — provisions trust + the OIDC client

```
Admin (on the HS server's "HearthShelf Connect" page) presses Connect
   |
   | POST /hs/hosted/pair   (ABS-admin authenticated, server-side)
   v
HS server  -- POST /pairing/start -->  Control plane
   |                                      |  - records pairing code (15m, one-time)
   |                                      |  - returns issuer, jwks_url, server_secret, code
   |  persists issuer/jwks/secret; shows CODE to admin
   v
Admin enters CODE on app.hearthshelf.com  (or follows /pair?code= deep link)
   |
   | POST /pairing/redeem  (Clerk-authenticated)
   v
Control plane:
   1. validate code (live, one-time, unexpired)
   2. upsert server + create link (this Clerk user is the server's admin owner)
   3. PROVISION a dedicated Clerk OAuth client for THIS server:
        POST https://api.clerk.com/v1/oauth_applications
          name: "HearthShelf server <id>"
          redirect_uris: ["<server public_url>/auth/openid/callback"]
          scopes: openid email profile
        -> { client_id, client_secret }
   4. PUSH OIDC config into the server's ABS (server-to-server, via the HS
      gateway using the stored server_secret as authorization):
        the HS server calls ABS PATCH /api/auth-settings with:
          authActiveAuthMethods: ['local','openid']
          authOpenIDIssuerURL: https://clerk.hearthshelf.com   (ABS discovers the rest)
          authOpenID{Authorization,Token,UserInfo,Jwks}URL: from discovery
          authOpenIDClientID / authOpenIDClientSecret: the per-server client
          authOpenIDMatchExistingBy: 'email'
          authOpenIDAutoRegister: true
          authOpenIDTokenSigningAlgorithm: 'RS256'
          authOpenIDSubfolderForRedirectURLs: ''   (-> /auth/openid/callback)
   5. mark pairing redeemed
```

Result: the server is linked **and** its ABS now trusts Clerk for this server
only. The client_secret lives only in that ABS instance and (transiently) in the
provisioning call; the browser never sees it.

> Note: ABS supports discovery via `GET /auth/openid/config?issuer=<URL>`
> (Auth.js:456). We set the issuer and let ABS fill the endpoint URLs, so the
> control plane does not hardcode Clerk's authorize/token/userinfo/jwks paths.

### 4.2 Connect to a server (per session, user) — the login bounce

ABS's callback is same-origin protected (OidcAuthStrategy.js:514-558): it will
**not** redirect to `app.hearthshelf.com` directly. So the flow bounces through
the server's own origin and hands the token back to the SPA explicitly.

```
SPA (app.hearthshelf.com) — user picks server Y
   |
   | optional: mint a control-plane grant to AUTHORIZE the bounce
   | (proves "this Clerk user is linked to Y" before sending them to Y's login)
   v
Browser -> https://<server-Y>/auth/openid        (ABS starts OIDC, PKCE+nonce+state)
   |
   v
Clerk login (already signed in -> silent) -> consent -> back to ABS
   |
   v
https://<server-Y>/auth/openid/callback           (ABS validates, matches by
   |                                                verified email, mints ABS token)
   |  ABS redirects to its OWN callback target with ?setToken=<JWT>&accessToken=<JWT>
   v
A tiny return page on server Y's origin posts the token back to the SPA
   (postMessage to the app.hearthshelf.com opener, or the SPA opened the flow
    in a popup and reads the result) — see §5 for the exact handoff.
   |
   v
SPA stores the ABS access token for server Y (in memory) and calls
   https://<server-Y>/api/*  with  Authorization: Bearer <ABS JWT>
```

After this, the SPA talks **directly to server Y's ABS** with an ABS-native
token. The control plane and the HS Node backend are out of the data path.

### 4.3 Data path (steady state)

```
SPA  --Bearer ABS JWT-->  https://<server-Y>/api/libraries        (nginx -> ABS)
SPA  --Bearer ABS JWT-->  https://<server-Y>/api/items/:id        (nginx -> ABS)
SPA  --?token= ABS JWT->  https://<server-Y>/api/items/:id/cover  (img/audio)
SPA  --Bearer ABS JWT-->  https://<server-Y>/hs/*                 (HS features)
```

ABS covers/streams take the token as a `?token=` query param (img/audio tags
can't set headers) — verified contract. `/hs/*` keeps working with the ABS token
because the HS backend in hosted mode can validate an ABS token the same way the
self-hosted path does (it calls ABS `/api/me`); the per-user API-key machinery
becomes unnecessary for the browser path.

---

## 5. The cross-origin token handoff (the one tricky part)

ABS returns the token to a **same-origin** callback on server Y. We need it in
the SPA on `app.hearthshelf.com`. Two viable mechanisms; we pick **popup +
postMessage** as primary:

**Primary — popup + postMessage:**
1. SPA opens `https://<server-Y>/auth/openid?...&auth_cb=<server-Y>/hs/connect-return`
   in a popup. (`auth_cb` must be same-origin with Y — enforced by ABS.)
2. `/hs/connect-return` is a tiny HS-served page on Y's origin that reads
   `accessToken` from its URL and `postMessage`s it to the opener, restricting
   `targetOrigin` to `https://app.hearthshelf.com`.
3. SPA's `message` listener (origin-checked to `https://<server-Y>`) receives the
   token, closes the popup, stores the token in memory.

**Fallback — full-page redirect with state round-trip:** if popups are blocked,
navigate the top window to Y's `/auth/openid`, let it bounce to
`/hs/connect-return`, which then `302`s back to `app.hearthshelf.com/connected#token=...`
with a `state` nonce the SPA verifies. Token in fragment (never query) so it is
not logged.

Both require:
- A small **return endpoint on the HS server** (`/hs/connect-return`) — new work
  in the AGPL repo. It only relays the token ABS already minted; it mints nothing.
- ABS's `auth_cb` same-origin rule satisfied (the return page is on Y's origin).
- `targetOrigin` / `event.origin` pinned on both sides of postMessage.

---

## 6. CORS (must-design, currently absent)

The browser calls `https://<server-Y>` from `https://app.hearthshelf.com` — a
cross-origin request. ABS/nginx set **no CORS headers today**. Required:

- The HS server, in **hosted mode only**, must emit:
  - `Access-Control-Allow-Origin: https://app.hearthshelf.com`
  - `Access-Control-Allow-Headers: Authorization, Content-Type`
  - `Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`
  - Handle `OPTIONS` preflight.
- Scope it to the hosted origin only (not `*`), and only when the server is
  paired. Self-hosted-only servers keep today's same-origin behavior.
- This lands in nginx config (templated by mode) or the HS Node layer for `/hs/*`
  plus the nginx ABS locations. Covers `/api/*`, `/s/*`, `/hs/*`.
- We do **not** need credentials/cookies cross-origin (we use Bearer tokens), so
  `Access-Control-Allow-Credentials` stays off — simpler and safer.

---

## 7. Token lifecycle & refresh (must-design, currently absent)

- **ABS access token**: JWT, short-ish; ABS also issues a **refresh_token**
  cookie (`SameSite=lax`, 30d) — but that cookie is **cross-site** from the SPA's
  view and won't be sent. So the SPA cannot silently refresh via the cookie.
- **Refresh strategy**: when the ABS access token nears expiry, the SPA re-runs
  the **silent OIDC bounce** (§4.2) — Clerk session is still valid, so it
  completes without user interaction and yields a fresh ABS token. Cheaper than a
  password; invisible to the user.
- **Playback longevity**: a listening session can outlast a token. The audio
  element streams via `?token=`; on a 401 the SPA refreshes the token and retries
  the range request. Design the player's fetch layer to treat 401 as
  "refresh-and-retry once."
- **Socket.io**: ABS's socket authenticates with the ABS token; on expiry the
  socket reconnects with the refreshed token. (There is no HS-owned socket; the
  doc's "browser <-> HS Socket.io" line is corrected in ARCHITECTURE.md.)

---

## 8. Security properties & threat model

| Threat | Mitigation |
|---|---|
| Stored ABS passwords (honeypot) | None stored. OIDC federation; ABS mints its own token. |
| Leaked OIDC client secret | Per-server client; blast radius = one server; revoke on unlink. Secret never in browser. |
| Wrong-identity linkage | Match by **verified** email; ABS rejects `email_verified === false` (User.js:233). Clerk emits verified emails. |
| Open redirect on callback | ABS enforces same-origin `auth_cb` (OidcAuthStrategy.js:514-558); per-client redirect_uri allowlist of exactly one URL. |
| Token in URL logged | Tokens returned in **fragment**, not query, on the SPA hop; popup+postMessage avoids the address bar entirely. |
| Authz-code interception | PKCE S256 (ABS + Clerk both support) + `state` + `nonce`. |
| CSRF on the bounce | `state` nonce verified by the SPA; `targetOrigin`/`event.origin` pinned on postMessage. |
| Control-plane compromise | Not in the data path; cannot read libraries. Can stop issuing grants -> bounce authz fails within TTL. |
| Replay of a grant | Short TTL (5m); grant only authorizes the bounce, not data access. |
| Cross-origin cookie theft | We use Bearer tokens, not cookies, cross-origin; `Allow-Credentials` off. |

Spirit-rule check: **2** (no second auth screen — silent Clerk bounce) ✓,
**3** (easy+secure same path) ✓, **5** (zero stored ABS secrets steady-state) ✓,
**6** (offline trust — ABS verifies Clerk JWTs via cached JWKS, no control-plane
callback) ✓, **7** (mobile — see §10) ✓.

---

## 9. What shipped vs. what we're building

| Piece | Shipped (drift) | This design |
|---|---|---|
| Per-user ABS auth | API-key minting (`POST /api/api-keys`) | **OIDC federation** (ABS mints its own token) |
| Where it works | `/hs/*` only | `/api/*`, `/s/*`, `/hs/*` (the whole library) |
| ABS auth-settings push | not done | **done at pairing** (per-server client) |
| Secret at rest | ABS admin token cached on HS | per-server OIDC secret in that ABS only |
| Browser data path | (none — blocked) | direct SPA -> ABS with ABS token |

The API-key code in `server/lib/hosted.js` is **superseded** for the browser
path. Keep it only if a non-OIDC machine path still needs it (e.g. server-to-
server provisioning); otherwise retire it in cleanup.

---

## 10. Mobile (forward-compatible, no work now)

ABS already supports a mobile OIDC variant: `/auth/openid/mobile-redirect` with
`authOpenIDMobileRedirectURIs` allowlisting custom schemes (e.g.
`hearthshelf://oauth`) and client-supplied PKCE. A future native app reuses this
exact flow — the per-server client just adds the app's scheme to its redirect
allowlist. No web-only assumptions in this design (Bearer tokens, fragment
handoff) block mobile. (Spirit rule 7.)

---

## 11. Open confirmation items (do before/with build)

1. **Clerk free-tier**: written confirmation that creating OAuth applications
   (Clerk as provider) is free-plan. If gated to Pro, fall back to one shared
   confidential client with per-server redirect URIs (§3 row 2) — less isolation,
   still no browser-exposed secret.
2. **Clerk OAuth app fields**: confirm the exact `POST /v1/oauth_applications`
   body (scopes format, public/confidential flag, PKCE enforcement toggle).
3. **ABS behind the gateway**: ABS builds redirect_uri from the `Host` header
   (OidcAuthStrategy.js:292) — confirm the HS container forwards
   `X-Forwarded-Host`/`X-Forwarded-Proto` so the redirect_uri equals the public
   URL we allowlisted on the Clerk client. (nginx `abs_proxy.conf` already sets
   these — verify it matches `PUBLIC_URL`.)

---

## 12. Implementation order (once design is approved)

1. **Control plane**: per-server Clerk OAuth client provisioning at
   `/pairing/redeem`; store `client_id` (+ secret reference) per server; revoke on
   `DELETE /servers/:id`. (`control-plane/src/routes/pairing.ts`,
   `servers.ts`, new `src/lib/clerkOAuth.ts`.)
2. **HS server (AGPL)**: at pairing, push ABS `PATCH /api/auth-settings` with the
   per-server client; add `/hs/connect-return` relay; add hosted-mode CORS for
   `app.hearthshelf.com`; forward headers for correct redirect_uri.
3. **SPA**: implement the connect bounce (popup + postMessage, redirect
   fallback), per-server ABS token store (in memory), a direct ABS client
   (`src/api/absClient.ts`) for `/api/*` + covers/streams, and 401 refresh-retry.
   Replace the `ServerHomePage` stub with real library browsing.
4. **Retire** the API-key browser path; keep only if a machine path needs it.

Each step is independently testable: (1) provisions a Clerk client + writes ABS
settings (verify in ABS admin), (2) completes a manual OIDC login to a test
server, (3) renders a real library through the front door.
