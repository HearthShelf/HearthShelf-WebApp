## Why

Today, connecting another app to a HearthShelf server is a manual credential
paste. Audplexus can already send finished audiobooks to Audiobookshelf, but
wiring it up means the user opens ABS, mints an API key, copies the server URL,
finds the library id, and pastes all three into Audplexus. Every app that wants
to talk to a HearthShelf server repeats that ritual, and every one of them ends
up holding a long-lived credential the user cannot see, scope, or revoke.

That is the wrong shape for a platform. The user should authorize an app the way
they authorize a GitHub App: the app says what it wants, the user picks which
servers it may touch, and a single page afterwards shows everything connected
with a revoke button next to each.

This change builds that as a **general framework** - any app, not a named list.
Audplexus is the first client of it and the proof that it works, but nothing in
the design is Audplexus-specific.

## What Changes

- **Two kinds of app, split by where they run.** A **self-hosted instance app**
  (Audplexus, a personal script) is deployed once per user, so each running copy
  registers *itself* on first boot and gets its own credential - no console
  visit, no approval, invisible to the user. A **cloud app** (a hosted service
  like Hardcover integrating inward) is one deployment serving many users, so it
  registers once in a developer console and is reviewed before anyone else can
  connect it.
- **An instance app can only be authorized by the account that runs it.** This is
  what makes open registration safe, and it means a fake "Audplexus" can never be
  put in front of a stranger.
- **A store, for cloud apps only.** A platform admin approves a cloud app into
  the store, after which any user can discover and connect it. There is nothing
  to list for instance apps - you would be listing software, not a service.
- **Servers advertise where to authorize.** Each HearthShelf box serves
  `/.well-known/oauth-protected-resource` (RFC 9728) naming the control plane as
  its authorization server. This is what makes discovery generic: an app pointed
  at any box learns how to connect without knowing anything about HearthShelf.
- **Users authorize with a code.** The existing device-code pattern already used
  for pairing servers is extended to apps (RFC 8628): the app shows a code, the
  user approves it at `app.hearthshelf.com/connect`, choosing which servers and
  seeing which scopes are requested.
- **The control plane introduces; the server takes over.** Consent happens in the
  hosted app, because that is where the user's identity lives. Everything after -
  issuing tokens, refreshing them, revoking them, rate limiting - happens on the
  user's own server. Revocation is therefore **immediate**, and an established
  connection keeps working with the control plane unreachable.
- **Per-app rate limiting on the server**, so one looping integration cannot
  saturate someone's box, and a revoked-but-retrying app cannot either.
- **Coarse scopes.** `library:read`, `library:write`, `progress:read`,
  `progress:write`, `admin`. Deliberately few - a consent screen that cannot be
  read is not consent, and scopes cannot be narrowed later without breaking
  installed apps.
- **A connections page.** `app.hearthshelf.com/settings/connections` lists every
  connected app, the servers it reaches, its scopes, and when it was last used,
  with per-app and per-server revoke. The box gets a matching read-only
  `Config > Connected Apps` view so a server admin can see what is reaching their
  server.
- **Audplexus gains a "Connect to HearthShelf" button** that runs the flow and
  auto-creates its ABS library destination. This replaces the URL + key + library
  paste entirely.

## Capabilities

### New Capabilities
- `app-connections`: How a third-party application is registered, authorized
  against a user's servers, exercises that authorization, and is revoked.

## Non-goals

- **No paid apps, ratings, or install counts.** The store is a curated list, not
  a marketplace.
- **No automated review.** Store promotion is a human decision by a platform
  admin. There is no scanning or automated approval.
- **No event delivery to apps yet.** Apps will want to be notified when a book is
  added; ABS has no webhook support and no "item added" notification, so that is
  ours to build and needs its own change. This one is designed not to foreclose
  it - see "Planning for the other direction" in the design - by reserving an
  `events:*` scope axis and keeping the app un-dialled.
- **No new box credential concept.** An authorized app resolves to a per-user ABS
  API key through the grant rail that already exists.
- **No per-library scoping.** Scopes are server-wide by design (see above).
- **No Clerk OAuth clients.** Migration `0007_drop_oauth_clients` removed
  per-server Clerk OAuth applications for good reason; apps register with the
  HearthShelf control plane itself, and Clerk stays purely the end-user identity
  provider.

## Impact

**Four repos.** The control plane is the authorization server, the box is the
resource server, core carries the shared vocabulary, and Audplexus is the first
client.

- `HearthShelf-WebApp` (control plane): new `apps`, `app_installations` (a
  mirror - the server is authoritative), `app_installation_servers` D1 tables;
  registration for both app kinds, device flow, introduction tokens, store
  review; consent screen, connections page, dev console and store in the SPA.
- `HearthShelf` (box): `/.well-known/oauth-protected-resource`; the app token
  service (introduce, refresh with rotation, revoke); scope enforcement;
  per-app rate limiting; Connected Apps admin view.
- `HearthShelf-Core`: scope constants and installation/authorization types shared
  by the web apps and mobile.
- `audplexus`: device-flow client, "Connect to HearthShelf" UI, and automatic
  creation of the ABS `LibraryDestination` row on success.

Security-sensitive by nature: this issues credentials that reach a user's
library. The design notes call out token lifetimes, the confused-deputy risk in
scope enforcement, and why registration being open does not by itself grant
anything.
