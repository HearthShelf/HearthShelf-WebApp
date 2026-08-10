Ordered so each phase is verifiable on its own. Phases 1-3 ship a working flow
with `curl` as the client; Audplexus (phase 6) then proves the docs are usable by
someone who did not write them.

## 1. Control plane: data model

- [ ] 1.1 Migration `0016_app_connections.sql`. `apps`: app_id PK, name,
      secret_hash, homepage_url, requested_scopes, **kind** (`instance`|`cloud`),
      **family** (e.g. `audplexus`; NULL for one-off dev-console apps),
      **owner_clerk_user_id** (the account that runs an instance app / the
      developer of a cloud app), **listing_status** (`unlisted`|`pending`|
      `listed`; instance apps are permanently `unlisted` and may never be
      submitted), review_reason, reviewed_by, reviewed_at, created_at.
      `app_device_codes`: user_code, device_code, app_id, scopes, status,
      clerk_user_id, server_ids, expires_at, last_polled_at.
      `app_installations` (the CP's MIRROR - see design; the box is authoritative):
      id, app_id, clerk_user_id, scopes, created_at, last_seen_at.
      `app_installation_servers` (installation_id, server_id).
      Note there is NO refresh_token_hash here - refresh lives on the box.
      Comment each table the way `0008`/`0015` do - the *why*, not the columns.
- [ ] 1.2 `lib/apps.ts`: registration (both kinds), lookup, installation-mirror
      CRUD, review transitions. Secrets hashed at rest via the existing
      `sha256Hex`; compare with `timingSafeEqual`.
- [ ] 1.3 Scope constants + validation in one place, imported everywhere. An
      unknown scope must be rejected at registration and at request time. Leave
      the `events:*` prefix unused and unclaimed - a later change adds event
      delivery on that axis, and re-interpreting a shipped scope is not possible
      once apps depend on it.

## 2. Control plane: registration + device flow

- [ ] 2.1 `routes/apps.ts` - `POST /apps/register` (RFC 7591 shape), serving BOTH
      kinds:
      - **instance**: unauthenticated, called by the app itself on first boot.
        Presents a family + its self-generated public key; gets its own app_id +
        secret. No dev console, no human step - this is the Audplexus path and
        must stay invisible to the user.
      - **cloud**: Clerk-authenticated from the dev console, records the
        developer as owner.
      Rate-limit per account AND per family+IP, so instance self-registration
      cannot be used to mass-mint identities.
- [ ] 2.1a Dev console management (cloud + hand-built): list own apps, rotate
      secret, delete (revoking every authorization anyone held), submit for
      review.
- [ ] 2.1b **The ownership gate.** Approving an `instance` app must be refused
      when the approving user is not the account that runs it. Enforced at
      approval time, before any consent screen renders. This is the boundary the
      whole model rests on - a fake "Audplexus" must never reach a stranger's
      consent screen. Cover it with a test.
- [ ] 2.1c Submitting an `instance` app for review must be refused outright:
      there is nothing to list, and a listed instance app would imply a shared
      secret in a public binary.
- [ ] 2.1d Store endpoints: `GET /apps/store` (listed cloud apps only) and admin
      approve/reject/unlist behind the existing `requireAdmin`, each writing to
      `admin_audit`. Broadening scopes on a listed app resets it to `pending`.
- [ ] 2.2 `POST /apps/device/code` - app presents app_id + requested scopes, gets
      user_code, device_code, verification_uri, interval, expires_in.
- [ ] 2.3 `POST /apps/device/token` - the poll. Must return the RFC 8628 error
      codes exactly: `authorization_pending`, `slow_down`, `access_denied`,
      `expired_token`. Enforce the interval; a fast poller gets `slow_down`.
      On success returns **introduction tokens**, not refresh tokens (below).
- [ ] 2.4 Introduction tokens. On approval, mint ONE short-TTL single-use token
      **per approved server**, via the existing `lib/signing.ts` `mintGrant`,
      carrying `app_id` + `scopes`. Keep `aud` a single serverId: the box
      verifies with `jwtVerify(..., { audience: serverId })`, so an array would
      fail and loosening it would break replay resistance. This token is the
      app's introduction to that box and nothing more - it is NOT a refresh
      token, and the CP mints no further tokens for this app afterwards.
- [ ] 2.5 Mirror endpoints for the connections page: `GET /apps/installations`
      (the CP's mirror, marked as such), and a revoke that FORWARDS to the owning
      box rather than pretending to revoke locally. When a box is unreachable,
      say so - never report a revoke that did not happen.
- [ ] 2.6 Unlinking a server must cascade into `app_installation_servers` and
      notify the box. Do this in the existing unlink paths in `routes/servers.ts`
      (both the user `DELETE /servers/:id` and `unlink-from-server`), not only in
      new code.

## 2b. Box: token service (the steady state)

The box is authoritative for everything after the introduction. All of this must
work with the control plane unreachable.

- [ ] 2b.1 `POST /hs/apps/introduce` - accept a CP introduction token, verify it
      through the EXISTING grant path (`server/lib/hosted.js`), and create a
      local app installation. Single-use: a replayed introduction token is
      refused. Must work when reached at a LAN address, since that is the common
      case for a same-machine app.
- [ ] 2b.1a Return the box's addresses with the introduction response so the app
      can pin a route for later (preferred / hs.direct / LAN), the same triple
      the SPA gets from `GET /servers`.
- [ ] 2b.2 Local storage for app installations: app_id, family, clerk subject,
      resolved ABS user, scopes, refresh_token_hash, created_at, last_used_at.
- [ ] 2b.3 `POST /hs/apps/token` - refresh -> short-TTL access token. Rotation
      with reuse detection (OAuth 2.1): each exchange issues a new refresh token
      and retires the presented one; replaying a retired token revokes the whole
      installation. Short grace window so an app that crashed before persisting
      the new token can retry without nuking a live connection.
- [ ] 2b.4 `DELETE /hs/apps/installations/:id` - **instant** revocation. The next
      request from that app fails; there is no TTL to wait out.
- [ ] 2b.5 Re-introduction updates the existing installation in place rather than
      duplicating it; a newly requested scope requires fresh consent via the CP.

## 3. Control plane: consent + connections UI

- [ ] 3.1 `/connect` route in the SPA: enter code (or arrive with `?code=`),
      Clerk-authenticated. Shows app name, scopes in plain language, and a server
      multi-select. Distinguishes a store-listed cloud app from "your own
      instance of Audplexus" - informational framing, since the ownership gate
      (2.1b) is the actual control.
- [ ] 3.2 Approving with no server selected is refused in the UI and on the
      server - the API is the real gate.
- [ ] 3.3 `/settings/connections`: list connections with servers, scopes,
      last-used, and throttle state; revoke. Reads LIVE from each box where
      reachable and falls back to the CP mirror marked "unreachable" - never
      show a comfortable lie. Revoke forwards to the box; if it cannot be
      reached, say the revoke did not happen. Follow the existing
      degrade-don't-throw convention.
- [ ] 3.3a `/settings/developer`: the dev console, for CLOUD and hand-built apps
      only. Self-hosted instance apps self-register (2.1) and must never require
      a visit here - if a normal Audplexus user ever needs this page, the
      instance path is broken. Owner-scoped; never lists another user's apps.
- [ ] 3.3b `/apps`: the store - browse listed cloud apps, start a connection from
      a card. Admin review queue lives in the existing admin surface.
- [ ] 3.4 Plain-language scope strings live beside the constants, not inline in
      JSX, so the box and mobile can render the same words.

## 4. Box: resource server

- [ ] 4.1 Serve `/.well-known/oauth-protected-resource` (RFC 9728): authorization
      server URL, supported scopes. Unauthenticated, and discloses nothing about
      users or content.
- [ ] 4.2 Access-token verification learns `app_id` + `scopes`. (Introduction
      tokens keep the existing single-`aud` grant check - see 2.4.)
- [ ] 4.3 Enforce scopes at the point the resolved ABS credential is handed out
      (`server/lib/hosted.js`), NOT per-route - a per-route check will be missed
      by the next route added.
- [ ] 4.4 Intersect scope with the authorizing user's real ABS permissions. A
      `library:write` scope must not let a user without delete permission delete.
      This is the confused-deputy guard; cover it with a test.
- [ ] 4.5 Per-(app, user, server) rate limiting on the box, with a tighter bucket
      for writes than reads. Exceeded requests get `429` + `Retry-After`. Record
      sustained throttling so the connections page can surface "this app is being
      throttled" - the signal that lets a user revoke something misbehaving.
- [ ] 4.6 `Config > Connected Apps`: apps authorized against this server, with
      scopes, last-used, and throttle state. Admin-only. Revocation here works
      with the control plane unreachable.

## 5. Core

- [ ] 5.1 Scope constants, `AppInstallation` / `AppAuthorization` types, and the
      plain-language scope descriptions. React-free.
- [ ] 5.2 Edit in `C:\code\HearthShelf-Core`, commit, push, then pull the
      submodule in each consumer and commit the updated ref. Never edit the
      submodule checkout in place.

## 6. Audplexus: reference client

Net-new code. There is no existing HearthShelf client in that repo - the only
mention is a comment at `internal/web/server.go:2888` about the *inverse*
integration. Do NOT start from `internal/auth/oidc.go`: that is Audplexus as a
relying party for its own login, which is the opposite direction.

- [ ] 6.1 `internal/hearthshelf/`: device-flow client - self-register on first
      boot (family `audplexus`), request code, poll with backoff honouring
      `slow_down`, introduce to the box, persist the refresh token (encrypted
      with the existing `crypto.Box`, as the OIDC secret and Audible creds are),
      refresh before expiry. Outbound only - Audplexus needs no public URL, no
      port forward, and no callback endpoint.
- [ ] 6.1a Prefer the box's LAN address when present (Audplexus is usually on the
      same machine or network), and perform the `serverIdentity` challenge before
      presenting anything to a private address. Fall back to the public /
      hs.direct address. Honour `429` + `Retry-After` rather than hammering.
- [ ] 6.2 Settings UI: "Connect to HearthShelf" showing the user code and a link
      to the verification URI, polling until approved.
- [ ] 6.3 On success, create the `LibraryDestination` row (type `abs`) with the
      resolved URL and credential. Ask the user only for the library choice.
- [ ] 6.4 Handle revocation gracefully: a refused refresh surfaces as
      "reconnect needed" in the UI, not a crash loop or a silent stall.
- [ ] 6.5 Existing manual ABS destination config keeps working - this is an
      additional path, not a replacement.

## 7. Proving it

- [ ] 7.1 Test the phase-1/2 flow with curl before any UI exists.
- [ ] 7.2 Cover the refusals specifically - they are the security surface:
      out-of-scope write, unauthorized server, revoked token, expired code,
      fast polling, scope exceeding user permission, **non-owner authorizing a
      private app**, **replayed retired refresh token**, and a grant minted for
      server A replayed against server B.
- [ ] 7.3 End-to-end on the AIO test box: authorize Audplexus, confirm a
      downloaded book lands in the library, revoke, confirm it stops.
- [ ] 7.4 Write the app-author guide: discovery, registration, flow, scopes,
      error codes. If phase 6 was awkward to implement, fix the docs here.
      Cover BOTH registration paths - self-registering (Audplexus) and manual via
      the dev console - since a third-party developer shipping a Home Assistant
      or similar integration may start with the manual one. Do not imply a
      Home Assistant device-flow helper exists: the architecture RFC was accepted
      in Jan 2026 but is pending type-aware application credentials, so an
      integration implements the polling itself in its config flow today.
