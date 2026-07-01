# Account Switcher — Implementation Plan

> Status: BUILT (backend + frontend), typechecks clean, not yet deployed/e2e-tested
> against real Clerk keys. Target: make the WebApp usable on a shared car screen —
> click the user photo to "Sign in another user" and, when several are remembered,
> swap between them fast.

## 1. Goal & UX

From the kitchen-table demo: *"How do I get to my account?"* We want the sidebar
user photo (bottom-left) to open a menu that:

- lists the accounts **remembered on this device**, each tappable to swap into,
- offers **"Sign in another user"** (adds a new account without signing the current one out of the roster),
- shows **"Log out"** for the active user.

Swapping into a remembered user should feel instant and password-free. Swapping
into a **PIN-protected** user first shows the touch PIN pad (already built).
Signing in a **brand-new** user always requires their real Clerk sign-in.

Explicitly **not** the Plex "pick a profile every launch" model — the app opens
straight into whoever was last active.

## 2. The constraint that shapes everything

**Clerk multi-session is Pro-only ($20/mo). We are on the free tier.** So the
browser can hold exactly **one** live Clerk session at a time. We cannot keep N
sessions warm and call `setActive({ session })` to flip between them (that whole
API is gated).

Therefore "remember multiple users and swap without a password" requires us to
persist *something* per remembered user and re-authenticate on swap. The naive
version — store each password in `localStorage` and replay it — is **rejected**:
it stores real credentials client-side, violating both the app's existing
"no tokens in localStorage" boundary (`src/lib/absTokens.ts`) and the repo/agent
safety rules. We do not build that.

## 3. Chosen mechanism: Clerk sign-in tokens, brokered by the control plane

Clerk's Backend API can mint a **sign-in token** for a given user id
(`createSignInToken(userId, expiresInSeconds?)`). It is:

- **single-use**, short-lived (we set a small expiry, e.g. 60s),
- minted **only with the Clerk secret key** → must come from the control-plane
  Worker, never the browser,
- **not** a Pro feature (unlike multi-session),
- redeemed on the frontend with the **ticket** strategy:

```ts
const res = await signIn.create({ strategy: 'ticket', ticket })
if (res.status === 'complete') await setActive({ session: res.createdSessionId })
```

Redeeming a ticket signs the browser into that user and makes it the active
session (replacing the current one — which is fine; we only ever want one live).

### What the browser actually stores

Per remembered user, the browser stores an **opaque, revocable device handle** —
NOT a password, NOT a Clerk token, NOT anything that authenticates on its own.
It is a random string that only means something to the control plane, which maps
it (server-side) to a Clerk user id and can revoke it at any time.

Swap flow:
1. User taps a remembered profile (passes PIN gate if set).
2. SPA calls `POST /accounts/switch-token` with the device handle (authenticated
   as the *currently* signed-in user).
3. Worker validates the handle, mints a fresh Clerk sign-in token for the target
   user, returns the ticket.
4. SPA redeems the ticket → `setActive` → now signed in as the target user.

The local artifact is a server-brokered pointer, so "remembering" a user never
means holding their credential. Revocation is real (delete the handle row).

## 4. Distinction the plan must not blur

There are **two** token layers in this app; the switcher touches the first:

| Layer | Who it authenticates | Minted by | Existing? |
| --- | --- | --- | --- |
| **Clerk sign-in token** (this feature) | a *different* Clerk user, to switch the browser's identity | `CLERK_SECRET_KEY` → Clerk BAPI `createSignInToken` | NEW |
| **ABS grant** (`mintGrant`) | the *already-signed-in* Clerk user, to talk to an ABS box | `CP_SIGNING_JWK` (Ed25519) | exists (`/servers/:id/grant`) |

Do **not** reuse `mintGrant()` for switching — it signs a grant for whoever is
already authenticated; it cannot authenticate someone else. After a successful
Clerk swap, the normal ABS-grant path runs for the new user as it does today.

## 5. Backend work (control-plane Worker)

Repo: `control-plane/` (Hono 4, D1 binding `DB`, Clerk verify in
`src/lib/clerk.ts` via `verifyClerk`, JWKS at `CLERK_JWKS_URL`).
`CLERK_SECRET_KEY` is already a configured secret (used today for invitations).

### 5.1 Migration `0007_device_handles.sql`

```sql
CREATE TABLE IF NOT EXISTS device_handles (
  handle          TEXT PRIMARY KEY,   -- opaque random id stored in the browser
  clerk_user_id   TEXT NOT NULL,      -- the user this handle can sign in as
  label           TEXT,               -- display name/email snapshot for the roster
  image_url       TEXT,              -- avatar snapshot (Clerk imageUrl)
  pin_hash        TEXT,               -- optional; NULL = no PIN required
  created_at      INTEGER NOT NULL,
  last_used_at    INTEGER,
  expires_at      INTEGER             -- absolute expiry; sweep/reject when past
);
CREATE INDEX IF NOT EXISTS idx_device_handles_user ON device_handles(clerk_user_id);
```

Notes:
- The **handle** is the browser-held secret; treat it like a bearer credential
  for *requesting a switch* (not for being signed in). Store it hashed at rest?
  No — we need to look it up by value; instead make it high-entropy (32 bytes)
  and rely on row-level revocation + short `expires_at`. (Open question 8.1.)
- `pin_hash`: PBKDF2/scrypt of the 4-digit PIN + per-row salt. A 4-digit PIN is
  low-entropy, so the PIN is a *shared-screen courtesy gate*, not a real secret;
  document that. Rate-limit attempts (8.3).

### 5.2 New route `control-plane/src/routes/accounts.ts`, mounted in `src/index.ts`

- `POST /accounts/remember` — auth: `requireUser`. Body: `{ pin? }`. Creates a
  device handle for the **current** Clerk user (from the verified JWT), snapshots
  label/imageUrl, stores optional `pin_hash`, returns `{ handle, label, image_url }`.
  This is what "remember me on this screen" calls.
- `POST /accounts/switch-token` — auth: `requireUser` (must be signed in as
  *someone*). Body: `{ handle }`. Looks up the handle, checks not-expired, mints
  a Clerk sign-in token for `handle.clerk_user_id` via BAPI, updates
  `last_used_at`, returns `{ ticket, expires_in }`. **PIN is verified client-side
  before this call is made, but also re-checked here** if `pin_hash` is set
  (never trust the client alone) — body carries `{ handle, pin? }`.
- `DELETE /accounts/remembered/:handle` — auth: `requireUser`. Removes a handle
  (forget this profile / sign out everywhere for it). Only allow deleting a
  handle whose `clerk_user_id` matches the caller, OR any handle the caller's
  browser presents (see 8.2 — the "who can forget whom" rule).
- `GET /accounts/remembered` — optional: the roster is really client-held (the
  browser knows its own handles), but an endpoint to hydrate label/avatar/pin
  presence keeps snapshots fresh.

### 5.3 Clerk BAPI call

Add to `src/lib/clerk.ts` a `createSignInToken(env, userId, ttlSec)` that POSTs
to `https://api.clerk.com/v1/sign_in_tokens` with
`Authorization: Bearer ${env.CLERK_SECRET_KEY}`, body `{ user_id, expires_in_seconds }`.
Returns `{ token }`. (Confirm exact response field name against BAPI at build
time.)

## 6. Frontend work (SPA)

### 6.1 Local roster store — `src/store/rememberedAccounts.ts` (zustand + persist)

```ts
interface RememberedAccount { handle: string; label: string; imageUrl?: string; hasPin: boolean }
// persisted to localStorage key 'hearthshelf:remembered'
// ONLY opaque handles + display snapshots. No tokens, no passwords.
```

This is the one new thing in `localStorage`, and it is deliberately non-sensitive
(a stolen handle can request a switch *ticket* from the CP, but the CP mints
tickets only over an authenticated request and we can revoke handles — see 8.1).

### 6.2 Client API — `src/api/controlPlane.ts`

Add `rememberCurrentUser(pin?)`, `requestSwitchTicket(handle, pin?)`,
`forgetRemembered(handle)` following the existing `request<T>()` pattern.

### 6.3 Swap orchestration — `src/auth/useAccountSwitch.ts`

```
switchTo(account):
  if account.hasPin -> await PinEntryOverlay gate (already built)
  { ticket } = await requestSwitchTicket(account.handle, pin)
  res = await signIn.create({ strategy: 'ticket', ticket })
  if res.status === 'complete': await setActive({ session: res.createdSessionId })
  else: surface error (MFA/edge -> fall back to full Clerk sign-in)
```

Uses `useSignIn()` + `useClerk().setActive`. On any failure, fall back to
`clerk.redirectToSignIn()` so the user is never stranded.

### 6.4 Sidebar switcher UI

- `src/components/layout/Sidebar.tsx` `UserMenu`: replace the current dropdown
  with a switcher that lists `rememberedAccounts`, a "Sign in another user" row
  (`clerk.openSignIn` / redirect, then on return offer "remember on this screen"),
  and "Log out".
- Mirror in `src/components/layout/MobileNav.tsx` drawer header.
- Reuse the existing `Avatar` component for each row.

### 6.5 PIN pad — DONE

`src/components/account/PinEntryOverlay.tsx` (+ CSS in `design.css`,
harness `/dev/pin`). Already verified. Plugs in at 6.3 as the pre-switch gate.

## 7. Shared-device prompt (on login)

After a fresh sign-in, if the device looks shared, ask "Is this a shared screen?"
**BUILT**: `src/components/account/SharedDevicePrompt.tsx` (container) +
`SharedDevicePromptCard` (pure presentational, previewable at `/dev/shared-prompt`).
- Detection: reuse `isCarBrowser()` from `src/hooks/useCarMode.ts` (Tesla UA /
  touch-only Tesla-sized panel). Treat car mode as a strong shared-device signal.
  Also skips the prompt if the current Clerk user is already remembered here.
- Two-step card: "Is this a shared screen?" (No/Yes) → "Set a PIN? (optional)"
  (Skip PIN / Save PIN, 4-digit numeric input). Yes+either button calls
  `rememberCurrentUser()`.
- Persisted via `src/store/deviceSettings.ts` (`askedSharedDevice`, separate from
  the account roster) so it only asks once per browser.
- Mounted once in `AppShell.tsx`.

## 8. Open questions — RESOLVED (2026-06-30/07-01)

1. **Handle theft.** Shipped as originally recommended: short `expires_at` +
   authenticated-request requirement + one-click revocation. Device-fingerprint
   binding not built; revisit if needed.
2. **PIN scope, resolved: fully independent per device.** A PIN lives on the
   `device_handles` ROW (i.e. per remembered device), not per Clerk account.
   Setting/changing/forgetting a PIN on one device never affects another
   device's remembered copy of the same account. No schema change needed - this
   was already how it worked; confirmed as the intended design.
3. **Forget flow, resolved.** Forgetting a PIN-protected handle normally
   requires that PIN (re-verified server-side, shares the switch-token attempt
   counter). A "Forgot PIN?" escape hatch inside the pad shows a `window.confirm`
   ("this removes {name} from this device, sign in again to use it here") and
   then force-removes via `DELETE .../remembered/:handle` with
   `confirm_forgot: true` (bypasses the PIN check). This ONLY removes the local
   handle - it does not sign the account out anywhere else (per user decision).
   **Built**: backend `checkPin()` shared helper in `accounts.ts`; frontend in
   `AccountSwitcher.tsx` (desktop/tablet) and `MobileNav.tsx` (drawer), both with
   a per-row "forget" (×) affordance next to each remembered account.
4. **PIN brute-force, resolved: 10 tries then logout.** `MAX_PIN_ATTEMPTS = 10`
   in `accounts.ts`. The counter is SHARED between switch-token and forget
   attempts (same `pin_attempts` column) - a guesser can't reset their budget by
   switching endpoints. At 10, the handle is deleted server-side (`410
   locked_out`), which both the swap and forget flows treat as "gone, prune
   locally". Verified against local D1 (counter increments, shared across
   simulated switch+forget attempts).
5. **"Log in with password" escape hatch, resolved.** `loginWithPassword()` in
   `useAccountSwitch.ts`: `signOut()` then `redirectToSignIn()`. Available as a
   menu row everywhere, AND as the automatic fallback whenever a swap or forget
   hits `locked_out`/`gone`/an unexpected error. Both "Log out" buttons
   (sidebar + mobile) now call this too, so logout always lands on a clean
   re-login rather than a stale redirect.
6. **BAPI response shape + errors.** Still unverified against real Clerk keys
   (no way to test without deploying/a working localhost Clerk domain). Fallback
   path in `useAccountSwitch.switchTo()` covers a non-`complete` status by
   surfacing an error rather than crashing, but this is unexercised in practice.
7. **Cost of the pivot.** Absorbed - backend + frontend both built (see below).

## 9. Build order — DONE

1. ✅ Migration + `accounts.ts` routes + BAPI helper.
2. ✅ `rememberedAccounts` store + client API + `useAccountSwitch`.
3. ✅ Sidebar + mobile switcher UI (including per-row forget).
4. ✅ Shared-device prompt.
5. ⬜ E2e on the AIO test box / real Clerk keys - NOT DONE. Everything up to the
   Clerk API boundary is typechecked and, where testable without live Clerk
   auth, verified via dev harnesses (`/dev/pin`, `/dev/switcher`,
   `/dev/shared-prompt`) and direct D1 queries. The `createSignInToken` mint +
   `signIn.create({strategy:'ticket'})` redeem round-trip is unproven.
   Recommend testing behind a flag or on a preview deploy before wide rollout.
