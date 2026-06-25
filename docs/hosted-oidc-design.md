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
the free tier (docs imply yes; not explicit). Tracked in §12.

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

## 7. Reachability & cross-origin HTTPS (the Plex `.plex.direct` problem)

CORS is necessary but **not sufficient**. Before the browser can make any
cross-origin call to a server, it must be able to open an **HTTPS connection with
a valid TLS certificate** to that server's public URL. For a self-hoster this is
frequently the hard part, and our OIDC flow silently assumes it works. It often
won't:

- A server at `https://192.168.1.7:13378` or a bare dynamic IP has **no CA-valid
  cert** → the browser refuses the connection (and `app.hearthshelf.com` is
  HTTPS, so a plain-HTTP server is **mixed-content blocked** outright).
- A server behind CGNAT / no port-forward is **not reachable** from the public
  internet at all.

The entire OIDC bounce (§4.2) and data path (§4.3) run **browser → that server's
own origin**, so if the browser can't reach the origin over valid HTTPS, none of
the auth design can execute. This is a peer problem to auth, not a footnote.

### How Plex solves it (reference) — DNS is free, the cert is the work

The mechanism splits into two halves with very different costs, and it is worth
being precise because it scopes what an `hs.direct` would actually cost us:

1. **DNS = stateless hostname-encoding, no records written.** A hostname like
   `192-168-1-7.<server-hash>.plex.direct` has the IP *encoded in the left label*.
   A single wildcard responder parses `192-168-1-7` and **synthesizes** the
   answer `192.168.1.7`. Plex writes **no** per-user/per-server/per-IP record;
   any IP resolves instantly with zero provisioning. (This corrects the common
   "Plex makes an A record per user" mental model — nothing is provisioned at the
   DNS layer.)
2. **Cert = per-server wildcard, server-held key — this is the real cost.** Each
   server is issued **one** Let's Encrypt wildcard cert for
   `*.<server-hash>.plex.direct` at claim time, covering all its possible IPs
   (LAN, WAN, dynamic) because they share the hash subdomain. **The media server
   holds its own private key**; plex.tv never holds it. The browser connects to
   `https://192-168-1-7.<hash>.plex.direct:32400` and the wildcard cert validates.

Plex also operates a **bandwidth-capped relay** fallback for when direct fails
(CGNAT/firewall), and the central registry returns *all* candidate connection
URIs (local, remote-direct, relay) for the client to try in order.

**Emby/Jellyfin do NOT solve this.** Emby Connect unifies the account but has no
plex.direct equivalent; Jellyfin removed Emby Connect entirely and tells users to
run a reverse proxy + their own Let's Encrypt. So "require a real HTTPS origin"
(Option A below) is literally what the entire Jellyfin/Emby ecosystem does — it
is a legitimate, well-precedented MVP, not a cop-out. A `plex.direct` equivalent
is the differentiator only Plex currently has.

### Our options (decision deferred; design now)

**Option A — self-hoster brings their own domain + valid TLS (MVP).**
The server must be published at a real HTTPS origin the self-hoster controls
(`https://books.example.com`), with a CA-valid cert (reverse proxy / Caddy /
Cloudflare Tunnel). The pairing flow already records `public_url`; we just
**require it to be a reachable HTTPS origin** and validate that at pairing (probe
it). Zero new infra for us; fine for power users; **excludes** the "just runs on
my LAN" crowd Plex serves. This is the natural MVP and what the rest of this doc
already assumes.

**Option B — an `hs.direct`-style service (parity with Plex). PLANNED follow-up.**
Two parts, per the cost split above:
- **DNS (cheap):** a stateless wildcard responder that parses the hyphenated IP
  from `<ip>.<hash>.<zone>` and synthesizes the A record. No per-server
  provisioning, no zone writes. Small always-on service (a CF Worker won't do raw
  DNS; use a tiny VM/container or managed authoritative-DNS-with-synthesis).
- **Cert (the real work):** mint a per-server Let's Encrypt **wildcard** cert for
  `*.<hash>.<zone>` at pairing and get the **private key onto that HS container**
  (**DNS-01** challenge — required for wildcards). This means ACME automation,
  per-server key generation + storage, and renewal/rotation on every server.
  Carries the documented **DNS-rebinding caveat** (a synthesized name can point
  at a private IP). The cert step can piggyback on the pairing step that already
  provisions the per-server OIDC client.

Highest UX parity (matches Plex; beats Emby/Jellyfin); ops cost concentrated in
the cert half.

**Domain decision (locked 2026-06-23):**
- **A separate registrable domain is NOT technically required** — `.direct` is
  Plex branding, not a requirement. The mechanism needs only (a) a DNS zone we
  control for wildcard synthesis and (b) DNS-01 wildcard certs, both of which work
  on a delegated **subdomain of `hearthshelf.com`**.
- **Plan: POC on a subdomain, production on a dedicated `.app` domain.**
  - **POC:** delegate e.g. `d.hearthshelf.com` to the synthesis service; certs for
    `*.<hash>.d.hearthshelf.com`. Zero new spend; proves the flow.
  - **Production:** register a dedicated **`.app`** domain via **Cloudflare**
    (lean: **`hearthshelf.app`**; alt: `hsdirect.app`) and swap the synthesis zone
    + cert base over. ~$14/yr. Server hostnames become
    `192-168-1-7.<hash>.hearthshelf.app`.
- **Why a separate registrable domain for production (security):** it sits on a
  different Public Suffix List entry from `hearthshelf.com`, so the rebinding-prone
  synthesized hostnames (which resolve to private IPs) and any cookies are
  **isolated** from `app.hearthshelf.com` / `clerk.hearthshelf.com`. `.app` is
  **HSTS-preloaded** (HTTPS enforced at the TLD), a genuine plus here. Note:
  `hearthshelf.app` vs `hsdirect.app` give **identical** isolation (different
  registrable domain from `.com` either way) — the choice is pure branding.
- **Registrar:** Cloudflare (pairs with CF DNS + ACME DNS-01 automation).
- The POC→production swap is a hostname/zone change in the synthesis service and
  the cert base; the per-server pairing flow that issues certs is unchanged.

**Option C — relay fallback (for CGNAT / unreachable servers).**
For servers with no inbound path, proxy the connection through an
HS-operated relay. This **reintroduces the control plane (or a relay) into the
data path** — in tension with Spirit rule (direct browser↔server) and with the
CF-Workers "no long-lived sockets" caveat. Treat as a later, opt-in degraded
mode, never the default; bandwidth and cost implications must be scoped first.

### How reachability gates the connect flow

Make reachability an explicit precondition the SPA checks **before** starting the
OIDC bounce, so the failure mode is a clear message, not a cryptic cert error:

1. At **pairing**, the control plane probes `public_url` for a valid HTTPS
   response; refuse to pair (or warn) if it is HTTP-only, IP-only, or
   unreachable. Record a `reachable: true/false` signal.
2. The server picker shows real per-server **status** (this is the
   `status: 'unknown'` placeholder in `fetchLinkedServers` today — wire it to an
   actual probe). Offline/unreachable servers are visibly non-openable.
3. On **Connect**, if the origin isn't reachable over valid HTTPS, surface
   "this server isn't reachable from the internet — see setup" instead of letting
   the OIDC popup fail opaquely.

**Recommendation:** ship **Option A** for MVP (require a real HTTPS origin,
validated at pairing + probed for status), and keep **Option B (`hs.direct`)** as
the planned UX-parity follow-up once the auth path is proven end-to-end. Option C
only if real demand from CGNAT users appears.

---

## 8. Token lifecycle & refresh (must-design, currently absent)

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

## 9. Security properties & threat model

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
callback) ✓, **7** (mobile — see §11) ✓.

### How this compares to Plex / Emby / Jellyfin (the reference implementations)

The three media servers that solved "one account, many self-hosted servers"
each take a different stance, and the comparison validates our choices:

- **Plex** — proprietary central **token broker**. plex.tv issues an opaque
  `X-Plex-Token`; a registry (`plex.tv/api/resources`) maps users to servers +
  per-share tokens; the server **validates by calling back to plex.tv** (cache
  fallback). Central, not federated.
- **Emby** — *Emby Connect* central account (unifies credentials) but **no OIDC**
  and **no plex.direct equivalent**; sparsely documented.
- **Jellyfin** — **removed** Emby Connect on forking; each server is an **auth
  island**. But the community **`jellyfin-plugin-sso`** adds **OIDC login to a
  self-hosted Jellyfin server** — i.e. exactly the pattern we are putting on ABS.
  It is an open-source, readable precedent for federating a self-hosted media
  server to an external OIDC IdP (study the flow/contract; do **not** copy code —
  arm's-length boundary). Jellyfin's **Quick Connect** (6-char code device link)
  is also a clean reference for our pairing-code UX.

Where our design is deliberately **stronger** than all three:

| Dimension | Plex | Emby / Jellyfin | This design |
|---|---|---|---|
| Token validation | phones home to plex.tv (or cache) | opaque, **server-stateful** session lookup | ABS verifies the Clerk JWT **offline via JWKS** (Spirit rule 6) |
| CORS | `Access-Control-Allow-Origin: *` (Tenable TRA-2020-35) | per-deployment (often reverse proxy) | scoped to `app.hearthshelf.com`, Bearer not cookies |
| Token transport | often in URL query strings | header or `api_key` query param | fragment / postMessage, never query |
| Credentials at rest | plex.tv stores each server's admin token (breached 2024/25) | per-server only (no central store) | control plane stores **no** ABS credential |
| Identity model | central broker | per-server islands (Jellyfin) | **federated OIDC** (central identity, autonomous offline verification) |

Where Plex is **ahead** and we owe parity work: **reachability** — Plex's
`*.plex.direct` wildcard-DNS + per-server cert and relay solve cross-origin HTTPS
to home servers (§7). **Emby and Jellyfin do not solve this either** — they punt
to a user-run reverse proxy — which is why §7 Option A (require a real HTTPS
origin) is well-precedented as the MVP. The other Plex edge is **instant
revocation** (central validation); our offline-JWKS model revokes within the
token TTL (the accepted trade for offline trust). Net: our identity layer is more
secure than all three; reachability (§7) is the one place we must catch up to
Plex, and we are no worse than Emby/Jellyfin there today.

---

## 10. What shipped vs. what we're building

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

## 11. Mobile (forward-compatible, no work now)

ABS already supports a mobile OIDC variant: `/auth/openid/mobile-redirect` with
`authOpenIDMobileRedirectURIs` allowlisting custom schemes (e.g.
`hearthshelf://oauth`) and client-supplied PKCE. A future native app reuses this
exact flow — the per-server client just adds the app's scheme to its redirect
allowlist. No web-only assumptions in this design (Bearer tokens, fragment
handoff) block mobile. (Spirit rule 7.)

---

## 12. Open confirmation items (do before/with build)

1. **Clerk free-tier**: written confirmation that creating OAuth applications
   (Clerk as provider) is free-plan. If gated to Pro, fall back to one shared
   confidential client with per-server redirect URIs (§3 row 2) — less isolation,
   still no browser-exposed secret.
2. **Clerk OAuth app fields**: confirm the exact `POST /v1/oauth_applications`
   body (scopes format, public/confidential flag, PKCE enforcement toggle).
3. **ABS behind the gateway — VERIFIED 2026-06-24**: ABS builds redirect_uri from
   the `Host` header (OidcAuthStrategy.js:292-293, :327). `abs_proxy.conf` sets
   `Host`/`X-Forwarded-Host` to `$host` (the **raw inbound Host**), not
   `PUBLIC_URL`'s host. For Option A (fixed bring-your-own domain) these are equal,
   so the redirect_uri matches the allowlisted value — **no action for MVP**. For
   Option B (hs.direct) the inbound host is the changing IP-bearing label and
   diverges from the pinned stable host, so nginx must override these to the
   canonical `PUBLIC_URL` host. Tracked + resolved in
   `hs-direct-implementation.md` §2.4 / §5.
4. **Reachability (§7) — DECIDED**: MVP = Option A (require a CA-valid HTTPS
   `public_url`, validated at pairing). Option B (`hs.direct`-style) is the
   planned follow-up: **POC on `d.hearthshelf.com` subdomain, production on a
   dedicated `.app` domain** (lean `hearthshelf.app`, registered via Cloudflare,
   ~$14/yr) for PSL isolation + HSTS-preload. No domain purchase needed for MVP or
   POC. Without reachability the OIDC flow can't reach a typical home server.

---

## 13. Implementation order (once design is approved)

0. **Reachability gate (§7, MVP Option A)**: validate `public_url` is a
   CA-valid, reachable HTTPS origin at pairing; wire the server picker's
   per-server `status` to a real probe (replace the `status: 'unknown'`
   placeholder). Do this first — the rest can't be tested against an unreachable
   server.
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
