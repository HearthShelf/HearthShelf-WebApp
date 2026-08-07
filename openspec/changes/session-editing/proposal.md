## Why

Fall asleep with a book playing and you wake up to a six-hour session you never
heard. It inflates your stats, your streak, and your listening totals, and there
is nothing in either web app you can do about it.

The capability already exists on the server and is already implemented on
mobile - `deleteListeningSession` and `updateListeningSession` in
`HearthShelf-Mobile/src/api/abs.ts:459-486`. Neither web app exposes it. The
hosted app has a delete, but it lives in the admin surface
(`src/api/absAdmin.ts:398`) and is scoped to managing other people's data, not
correcting your own.

This is a straight gap-close: the listening history screen should let you delete
a session outright, or correct the time it recorded.

## What Changes

- The listening history screen gains a per-row action menu with **Delete
  session** and **Edit duration**.
- Delete removes the session and updates the page's derived totals without a
  full refetch.
- Edit lets you set what the session should have recorded - a corrected
  duration - and re-submits it.
- Both actions confirm before running, and both report failure plainly.
- **Both web apps get this.** The two `SessionsPage.tsx` copies have drifted;
  this change specifies one behaviour and applies it to each, using each repo's
  own auth seam.

## Capabilities

### New Capabilities
- `listening-history`: The listening history screen - what a session row shows,
  and how a listener corrects or removes a session that misrecords what they
  actually heard.

## Impact

**Both repos.** Behaviour is identical; the API layer differs because hosted
resolves a per-server origin and self-hosted is same-origin.

- `HearthShelf-WebApp`: `src/pages/SessionsPage.tsx`,
  `src/api/absLibrary.ts` (session write functions alongside the existing
  `getListeningSessions`).
- `HearthShelf`: `src/pages/SessionsPage.tsx`, `src/api/me.ts`.
- No `@hearthshelf/core` change. No server change - both endpoints already
  exist in ABS.

Server-side: `DELETE /api/sessions/:id` requires the account's delete
permission, so the action must handle a 403 rather than assume it will work.
