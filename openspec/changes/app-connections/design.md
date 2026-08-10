# Design: app connections

## The shape, in one picture

```
  Audplexus (any app)          app.hearthshelf.com (CP)         HS box
  ────────────────────         ────────────────────────         ──────
  register once  ─────────────► apps table
                                (app_id + secret hash)

  "Connect" ─────────────────► device_codes
   shows ABCD-EFGH              ▲
                                │ user approves, picks servers
                                │ + sees scopes
  poll ──────────────────────► app_installations
   ◄─── refresh token           (app × user × server × scopes)

  exchange refresh ──────────► short-TTL grant  (existing mintGrant)
  present grant ───────────────────────────────────────────────► verify
                                                                  + mintAbsApiKey
   ◄────────────────────────────────────────────── per-user ABS key
```

The bottom two rows are **existing code**. `mintGrant`
(`control-plane/src/lib/signing.ts`) and the box's grant→ABS-key exchange
(`HearthShelf/server/lib/hosted.js`, `mintAbsApiKey` around line 555) already do
exactly this for browser sessions. An app authorization adds `app_id` and
`scopes` claims to that same grant. **The box gains no new credential concept** -
it keeps resolving a grant to a per-user ABS key, and simply learns to enforce
two extra claims.

That is the load-bearing decision in this design. It is why this is a
several-day change rather than a rewrite of the auth stack.

## Why not Clerk OAuth clients

Migration `0007_drop_oauth_clients.sql` deleted a per-server Clerk OAuth client
model, and the reasoning there applies here with more force: it created a Clerk
object per relationship, could not be revoked once orphaned, and coupled our
authorization model to a billing-tiered feature of a third party.

So: **apps register with the HearthShelf control plane, not with Clerk.** Clerk
remains the end-user identity provider and nothing more. The CP is the
authorization server. This also keeps the whole flow available on Clerk's free
tier, which the account-switcher work already found to be a real constraint.

## Standards, and how closely we follow them

There is no MCP-equivalent for "connect an app to a media server" - MCP
standardizes tool *invocation*, not this. But MCP hit the same discovery problem
and solved it by composing OAuth RFCs, so we follow the same chain:

| RFC | What we take | Deviation |
| --- | --- | --- |
| 8628 device grant | the code UX and polling semantics (`authorization_pending`, `slow_down`, `expired_token`) | user code is 8 chars, base-20 consonant alphabet per the RFC's own advice |
| 7591 dynamic client registration | self-service registration, client metadata shape | no initial access token - registration is open (see below) |
| 9728 protected resource metadata | `/.well-known/oauth-protected-resource` on the box | ours also lists supported scopes so an app can pre-flight |
| 7636 / OAuth 2.1 | PKCE on any interactive flow; no implicit, no password grant | device flow needs no PKCE, but a future browser-redirect variant must have it |

Following real RFCs here is not ceremony - it means an app author can point a
stock OAuth library at us, and it means the multi-server selection (our one
genuine extension) is the only thing they must learn.

**Our extension over stock OAuth:** an *installation* is scoped to a set of
servers, not just a set of scopes. Stock OAuth has no vocabulary for "this app is
good for these three of the user's five backends."

Where that set lives matters, and the obvious implementation is wrong. A grant's
`aud` is a **single** `serverId` (`lib/signing.ts`), and the box verifies it with
`jwtVerify(..., { audience: serverId })` (`HearthShelf/server/lib/hosted.js:186`)
- a strict single-value check. Adding a `servers` **array** claim would fail
verification on every box, and loosening the audience check to accept a list
would weaken the one control ensuring a grant minted for server A cannot be
replayed against server B.

So the multi-server set lives in the **installation** (control plane, in
`app_installation_servers`), and a grant stays exactly what it is today:
single-audience, one server. An app holding an installation for three servers
exchanges its refresh token for three grants, one per server, each with
`aud = that server`. The app names which server it wants at exchange time; the CP
refuses if that server is not in the installation.

This keeps the box's verification code unchanged apart from reading two new
claims, and preserves replay resistance for free.

## The axis is where the app RUNS, not who wrote it

The obvious model - "private apps" that get promoted to "public apps" after
review - is wrong, and it took Audplexus to show why.

Audplexus is self-hosted. **Every user runs their own instance.** Alice's
Audplexus and Bob's are separate deployments on separate machines. There is no
single "Audplexus" to register, no operator holding a credential on behalf of
users, and nothing meaningful for a store to list: you would be listing
*software*, not a service. Worse, a shared listing implies a shared client
secret baked into a public binary - precisely the "public clients cannot keep
secrets" problem OAuth 2.1 exists to stop.

Hardcover integrating in the other direction is the opposite case: one cloud
deployment, one operator, many users. That genuinely needs a single registered
identity and genuinely needs review, because one credential reaches everyone.

So the real axis is **deployment topology**:

| | **Instance app** (self-hosted) | **Cloud app** (hosted service) |
| --- | --- | --- |
| Example | Audplexus, a personal script | Hardcover, a SaaS integration |
| Deployments | one per user | one, run by the developer |
| Registers | itself, automatically, at first boot | once, by its developer |
| Secret | unique per instance, generated locally | one, held by the operator |
| Who can authorize it | **only the account that runs it** | any user |
| Store listing | never - there is nothing to list | yes, after review |
| Review | none needed | platform admin approves |

This subsumes the earlier "private vs store" idea and fixes its blind spot. The
security property that made two tiers worth having is preserved exactly - an
instance app can only be authorized by the account running it, so a fake
"Audplexus" cannot be pushed at a stranger - but it now falls out of the topology
rather than being a review status someone has to remember to set.

### Instance apps register themselves

An instance app should not make its user visit a developer console. On first
boot it generates a keypair, self-registers as an instance of a **software
family** (`audplexus`), and receives its own `app_id` + secret. The user never
sees this; they see "Connect to HearthShelf."

The family is a label, not a credential: it lets the consent screen say "Audplexus
(your instance)" and lets the connections page group them. It confers no trust,
because anything can claim it - which is fine, since an instance app can only
ever be authorized by the person running it.

The dev console still exists, for someone hand-building an integration who wants
a credential without deploying anything. That is the same thing as an instance
app registered by hand.

### What review is actually for

Review gates exactly one thing: **an app one operator controls, reaching many
users' libraries.** That is the case where a single compromised credential is a
fleet-wide incident, and where a human should look before it is offered to
strangers. Instance apps never reach that state, so they never need review -
which is why "self-service from day one" and "reviewed store" are not in tension.

Guards that remain: rate-limit registration per account (and per family, for
instance self-registration) so mass-registering plausible names is not free, and
re-review a cloud app whose scopes broaden after listing, so approval cannot be a
bait and switch.

### Reusing platform_admins

Store review needs no new admin concept. `platform_admins` + the `requireAdmin`
gate + `admin_audit` (migration `0006`) already exist and carry exactly the right
semantics: fleet-wide staff, re-checked from D1 on every request, never trusted
from a JWT claim, with an append-only audit trail. Store approval is another
admin action written to that trail. Do not invent a parallel reviewer role.

## Worked example: a Home Assistant integration

Audplexus is the reference client because we control it. Home Assistant is the
better test of whether the framework works for someone we do *not* control, so it
is worth walking through - and it turns out to validate two decisions and flag
one caveat.

**Which kind is it?** Instance. Every HASS user runs their own instance, so a
HASS integration is the same topology as Audplexus: one deployment per user, its
own credential, authorizable only by the account running it. It must never be a
cloud app - one registered app whose secret ships inside a HACS repository is a
secret in public source reaching every user's library.

**How the developer builds it.** Two options, both supported:

1. *Manual (works today, zero platform work):* the integration's docs say "visit
   app.hearthshelf.com/settings/developer, create an app, paste the app_id and
   secret into the config flow." Each user does it once. This is what the dev
   console exists for.
2. *Self-registering (better UX):* the integration self-registers on first setup
   under family `hass-hearthshelf` and the user never sees a console. Same path
   Audplexus uses.

Option 1 is the floor and needs nothing from us; option 2 is the ceiling. A
developer can ship 1 and move to 2 later without breaking existing users.

**Why device flow fits HASS specifically.** HASS is very often headless -
a NUC or a Pi in a cupboard, configured from a laptop or phone. That is exactly
the case where a loopback redirect fails (`127.0.0.1` in the laptop's browser is
the laptop). The user sees a code in the HASS config flow, approves it on
app.hearthshelf.com from whatever device they are already holding, and the
integration polls. No public URL, no port forward, no reverse proxy.

**Caveat worth knowing.** HASS's own `application_credentials` platform does not
yet ship device-flow helpers. The
[architecture RFC](https://github.com/home-assistant/architecture/discussions/1299)
was accepted in January 2026 but is pending "type-aware" application
credentials, so today an integration implements the device flow itself inside its
config flow - as the Tado integration does. That is perhaps 100 lines of polling
against a documented endpoint, not a blocker, but our app-author guide (task 7.4)
should not imply a HASS helper exists.

Note also the maintainers' condition on that RFC: if an API supports both a
redirect flow and a device flow, integrations should prefer the redirect and
should not implement both. Ours offers only device flow in v1, so a HASS
integration has no ambiguity - which is a small argument for not rushing to add
loopback.

**What it would want next.** A HASS integration's natural desire is to *react* -
"a book was added, announce it." That is the event direction, which this change
deliberately does not build; see "Planning for the other direction". Until then
it can poll `library:read` on a HASS-appropriate interval, which is a legitimate
if unlovely v1.

## Scopes

Five, coarse, server-wide:

| Scope | Grants |
| --- | --- |
| `library:read` | read items, series, authors, covers |
| `library:write` | add/update items, trigger scans |
| `progress:read` | read listening progress and sessions |
| `progress:write` | write progress and sessions |
| `admin` | server administration; never granted implicitly |

Coarse because **a consent screen nobody reads is not consent**, and because
scopes can be widened later but never narrowed without breaking installed apps.
Per-library scoping was considered and rejected: it makes the consent screen a
tree, and the ABS permission model underneath is not per-library in a way that
would let us honestly enforce it.

`admin` is separated so the common case (an app that files audiobooks) never
prompts for anything frightening.

### The scope-vs-user-permission trap

A scope can only ever *narrow*, never widen. If a user with no delete permission
authorizes an app for `library:write`, the app must not be able to delete - the
effective permission is the intersection of the scope and the authorizing user's
own ABS permissions. This is the classic confused-deputy failure and the box is
the only place it can be enforced correctly, because the box is the only party
that knows the user's real ABS permissions. It must not be enforced solely in the
CP or solely in the app.

## The box owns the steady state; the CP owns the handshake

The first draft ran everything through the control plane, which made revocation
bounded-but-not-instant (a live grant kept working for up to its TTL) and put the
CP on the path of every token refresh forever. Both are avoidable by giving the
box its proper role.

**The split:**

| Phase | Who | Why |
| --- | --- | --- |
| Introduction: user code, consent, which servers | **control plane** | The user's identity lives in Clerk, and the app has not yet met the box. Only the CP can say "this Clerk user really did approve this app." |
| Steady state: refresh, access tokens, revocation | **box** | The box is the resource server. It already holds the ABS credential, already knows the user's real permissions, and is the only party that can enforce a decision *at the moment of use*. |

After consent, the CP hands the app a one-time, short-lived **introduction
token** naming (app, user, server, scopes). The app presents it directly to the
box, which verifies the CP signature it already trusts (the existing grant path)
and issues its **own** app credential. From then on the app talks only to the
box, and the CP is out of the loop.

**This is what makes revocation instant.** Revoking is a delete on the box, and
the box is the thing being asked - so the very next request fails. No TTL to wait
out, and no CP round-trip per request either: the earlier design's dilemma was
false, created by putting the CP in a position it did not need to occupy.

It is also correct for the offline case, which the earlier design got wrong: a
box whose internet is down could not have revoked anything, because revocation
lived in a cloud service it could not reach. Now a LAN client can connect,
refresh, and be revoked with the control plane entirely unreachable. That matches
how the rest of this architecture already behaves (JWKS pinned to disk, LAN
addresses, hs.direct fallback).

**Token lifetimes:**

- **User code**: 15 min, single use, consumed on approval. (CP)
- **Introduction token**: 5 min, single use, audience-bound to one server. (CP,
  reusing `mintGrant`)
- **App refresh token**: long-lived, rotating, revocable. (Box)
- **App access token**: short TTL. (Box)

The CP keeps a *record* of installations so the connections page can show
everything in one place across servers, but that record is a mirror, not the
authority. Where they disagree, the box wins - it is the one holding the data.
The connections page therefore reads live from each box where reachable, and
falls back to the mirror with an "unreachable" marker rather than showing a
comfortable lie.

### Nothing ever dials the app

The app needs **no inbound reachability, no public URL, and no port forward**.
Every arrow in this design points outward from the app: it registers, it polls,
it introduces itself, it refreshes. Nothing ever connects *to* it.

This is not incidental - it is why the device grant was chosen over an
authorization-code redirect.

### Why not a loopback redirect

To be fair to the alternative: a loopback redirect (`http://127.0.0.1:PORT/cb`)
**does** work, and it is the standard native-app pattern - RFC 8252, as used by
the GitHub CLI, `gcloud`, and most desktop OAuth clients. When the browser and
the app are on the same machine, it is a genuinely nicer flow than typing a code.

It is not chosen as the *only* flow because of where it stops working:

- **Browser on a different machine than the app.** Audplexus on an Unraid box or
  a Pi, configured from a laptop. `127.0.0.1` in the laptop's browser is the
  laptop - the redirect lands nowhere, or on whatever that laptop happens to be
  serving on that port. For self-hosted media software this is not an edge case;
  it is arguably the majority case.
- **It requires the app to serve HTTP the browser can reach.** Device flow
  requires nothing inbound at all, not even from the same host. That is a real
  reduction in requirements, not a stylistic preference.

So the honest comparison is: **device flow always works; loopback is nicer when
it applies.** RFC 8252 and RFC 8628 coexist for exactly this reason, and mature
clients often implement both and choose at runtime.

**Decision for v1: device flow only.** It covers every deployment, and typing an
8-character code is a few seconds of friction against a second flow that needs
PKCE, redirect-URI validation, and its own failure modes. This is a UX judgment,
not a technical impossibility - if code entry proves to be real friction for
desktop users, adding loopback later is a clean addition.

**If it is added later**, two constraints must hold, and they are the reason the
current design keeps `redirect_uri` out of the token model entirely: PKCE is
mandatory (a loopback client cannot keep a secret, and without PKCE any local
process can race the authorization code), and only loopback literals may be
accepted as redirect targets - never an arbitrary URL, or the app registry
becomes an open redirector. Adding loopback must not make a public address a
requirement for any app that does not already have one.

Corollary worth stating because it is easy to get wrong: **an app is not a
resource server.** It holds a credential and calls the box; the box never calls
it back. See "Planning for the other direction" below, which keeps that true even
once apps can receive events.

### How the app reaches the box

The introduction token names a server, and the app must connect to it. The
address comes from the CP alongside the token: the same preferred / hs.direct
fallback / LAN triple the SPA already receives in `GET /servers`.

The common case is that the app and the box are **on the same LAN** - Audplexus
and HearthShelf on one home server - so the app should prefer the local address.
That path is already built and already authenticated: `serverIdentity.js` exists
so a client can challenge a candidate origin and verify an Ed25519 signature
before handing over anything. An app MUST perform that identity check before
presenting an introduction token to a private address, for exactly the reason the
SPA does: on a LAN, any device can answer on an IP, and the introduction token is
a bearer credential.

So the reachability requirements are: the app needs outbound internet for the
introduction (and nothing after), and a route to the box - which may be entirely
local. A box with no public address at all still works for a same-LAN app once
introduced, which is the offline property above.

### Why the CP still owns the introduction

It is worth being explicit that this cannot be pushed to the box too. The box
does not know who a Clerk user is until a CP-signed grant tells it, and it has no
way to authenticate a browser session on app.hearthshelf.com. Consent has to
happen where the identity lives. What the box can own is everything *after* the
introduction - which is the part that recurs.

## Cross-repo seams

**Control plane** owns the authorization server: three tables (`apps`,
`app_installations`, `app_authorizations`), registration, device flow, token
exchange, revocation. The device-flow endpoints are close cousins of
`routes/pairing.ts` and should be read alongside it - but they are a separate
route file, because the subject differs (an app, not a server) and merging them
would make both harder to reason about.

**Box** is the resource server. It gains the well-known document, and grant
verification learns two claims. The enforcement point is wherever the resolved
ABS key is handed out today; scopes must be checked *there*, not sprinkled across
route handlers, or they will be missed on the next route someone adds.

**Core** carries scope constants and the installation/authorization types.
React-free, per the existing constraint. Both web apps and mobile consume it.
Edited in `C:\code\HearthShelf-Core` and pulled in - never in a submodule
checkout.

**Audplexus** is the reference client, and worth treating as such: if the flow is
awkward to implement in Go against our docs, it will be awkward for everyone.

Be clear about what exists there today: **nothing**. The repo's only HearthShelf
reference is a comment in `internal/web/server.go:2888` describing the *serving*
side of the inverse integration (`HearthShelf/server/routes/audplexus.js`, which
pulls diagnostics FROM Audplexus). This change is net-new code in a new
`internal/hearthshelf/` package, not an extension of existing integration code.

Two existing things it builds on, and one it must not be confused with:
- `LibraryDestination` type `abs` already holds url + api_key + library_id, so a
  successful authorization fills in a struct that ships today - the change is
  where those values come from, not what they are.
- `crypto.Box` (already used for the OIDC client secret and Audible credentials)
  is the right place to put the refresh token at rest.
- `internal/auth/oidc.go` is **not** a starting point. That is Audplexus acting
  as a relying party for its own *login* against an external IdP - inbound, and
  the opposite direction from an outbound API client. Reaching for it will lead
  someone down the wrong path.

It is additive in the sense that matters: the existing manual ABS destination
config keeps working, and the inverse integration is untouched.

## Planning for the other direction (not built here)

Apps will want to be told when something happens - a Home Assistant integration
that reacts to a book being added is the obvious case. This change does not build
that, but it must not foreclose it, so here is what we know and what to reserve.

### What ABS already has

Checked in `C:\code\audiobookshelf` rather than assumed:

- **Webhooks: no.** [Issue #1857](https://github.com/advplyr/audiobookshelf/issues/1857)
  ("media added", "progress update", "metadata update") is open and labelled
  *planned*, unimplemented since 2023.
- **Notifications: yes, but narrow.** `server/utils/notifications.js` defines
  exactly six events: `onPodcastEpisodeDownloaded`, `onBackupCompleted`,
  `onBackupFailed`, `onRSSFeedFailed`, `onRSSFeedDisabled`, `onTest`. **There is
  no "book added" event** - the one thing an integration would most want. They
  are delivered by POSTing a rendered title/body to an Apprise API URL
  (`NotificationManager.js:225`), which is a human-notification pipe, not a
  machine-readable event feed.
- **Socket.io: yes, and this is the useful one.** `SocketAuthority` emits ~30
  events including `item_updated`, `item_removed`, `episode_added`,
  `series_added`, `author_added`, `library_updated`, `task_started/finished`.
  Rich and real-time, but it is an authenticated *client* stream - something must
  hold a connection to receive it.

So ABS gives us a real event source (socket.io) but no delivery mechanism for
third parties, and a notification system too narrow and too human-shaped to build
on. The gap is ours to fill, exactly like narrator photos and book completions.

### The shape to reserve

The rule from above holds: **the app is never dialled.** A self-hosted app behind
NAT has no address to call, so a classic outbound webhook only serves cloud apps
and would strand precisely the apps this design centres on. Reserve instead:

- **App-initiated stream** as the primary: the app opens an authenticated
  long-lived connection (SSE or websocket) to the box and receives events. Works
  behind NAT, needs no inbound route, and reuses the access token this change
  already issues.
- **Outbound webhooks as an optional extra** for cloud apps that do have a public
  URL - never the only option, and never assumed.

Both are strictly additive. Nothing in the current token model needs to change.

### What to reserve NOW so it stays cheap

1. **Scope namespace.** `library:read` etc. are about calling the box. Events
   need their own axis - `events:library`, `events:progress` - so an app can
   receive without gaining read access, and vice versa. Adding a scope later is
   easy; *re-interpreting* an existing one is not, so leave the namespace clear.
2. **Don't burn the word "webhook"** in user-facing copy or column names for
   anything meaning "the box calls out". The stream is the primary mechanism and
   the naming should not imply otherwise.
3. **Rate limiting is per (app, user, server)** - a held-open stream must be
   counted as a connection, not as a request, or the first streaming app trips
   the limiter designed for polling.
4. **The scope-intersection rule applies to events too.** An event carrying item
   details is a *read*. An app must not learn through the event feed what it
   could not have fetched, and the authorizing user's own ABS permissions still
   bound it. This is the same confused-deputy guard, and it is much easier to get
   right if it is remembered before the feed exists.

Deliberately NOT decided now: SSE vs websocket, event payload shape, delivery
guarantees (at-most-once vs replay), and whether the box or HearthShelf's own job
layer is the event source. Those need their own change.

## Per-app rate limiting

An authorized app is a program, and programs retry in loops. Without a limit, one
buggy integration can saturate a Raspberry Pi running someone's library - and the
user's only diagnosis is "HearthShelf is slow." Rate limiting belongs in this
change, not a later one, because it is also the only thing standing between a
revoked-but-retrying app and a box's CPU.

It goes **on the box**, for the same reason refresh does: the box is where
requests actually land, and it must work with the CP unreachable.

Limits are per (app, user, server) so one app cannot starve another, and one
user's runaway integration cannot degrade a housemate's listening. Exceeded
requests get `429` with `Retry-After` - a real header apps already understand,
not a bespoke error. Writes get a tighter bucket than reads, since a write loop
is both more damaging and less likely to be legitimate.

Sustained limit-hitting is worth surfacing on the connections page: "this app is
being throttled" is exactly the signal that lets a user revoke something
misbehaving, and it costs nothing to record once the counter exists.

## What could go wrong

- **Scope enforcement missed on a route.** Mitigated by enforcing at the
  credential-resolution point rather than per-route.
- **An app hoards its refresh token in plaintext.** We cannot prevent this; we
  bound it with revocation and last-used visibility so a user can notice and cut
  it off.
- **A user authorizes an app against a server they later unlink.** The spec
  requires the authorization to die with the link; this is easy to forget because
  the two live in different tables.
- **Clock skew on short-TTL grants.** Already a solved problem in the existing
  grant path; do not re-solve it differently here.
