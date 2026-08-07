## Context

`SessionsPage.tsx` exists in both web repos and has drifted: hosted paginates at
25/page with Prev/Next and normalizes the ABS response into a
`ListeningSession` DTO (`src/api/absLibrary.ts:708-774`); self-hosted fetches a
flat 100 and reads raw ABS field names (`src/api/me.ts:18-25`). Both group by
day and derive four summary tiles client-side.

Mobile already implements both writes (`HearthShelf-Mobile/src/api/abs.ts`):
delete at :459, update at :472. The update is the interesting one - ABS has no
session PATCH, so it re-submits through `/api/session/local` (the offline-replay
ingest) keeping the original id, which makes the server update in place instead
of inserting a duplicate. Only `timeListening` and the day (re-derived from
`updatedAt`) are honoured on an existing session.

## Goals / Non-Goals

**Goals:**
- Let a listener remove or correct a session that misrecords what they heard.
- Same behaviour in both web apps.
- Keep the on-screen totals honest immediately after a correction.

**Non-Goals:**
- Bulk selection or multi-delete.
- Editing anything other than duration. The ingest only honours
  `timeListening` and the day, so exposing more would be a lie.
- Changing how history is fetched, paginated, or grouped.
- Admin-side session management, which already exists separately in the hosted
  app (`src/api/absAdmin.ts:398`).

## Decisions

### Reuse mobile's re-ingest trick rather than inventing an edit path

ABS has no endpoint for editing a session. Mobile solved this by POSTing to
`/api/session/local` with the original id. That is not a workaround worth
re-deriving per platform - the web apps should do exactly the same thing, and
the comment explaining why should travel with it.

Consequence: the write takes a full session object, not a patch. The page
already holds every field it needs from the list response.

### Duration only

The ingest honours `timeListening` and the day. A UI offering to edit the
start time or the book would appear to work and then silently drop the change.
One field, honestly labelled.

### Optimistic, with rollback

A delete that waits on a round-trip before the row leaves feels broken. The row
goes immediately and restores on failure. This matters more than usual here
because the totals are derived from the list - an optimistic delete keeps the
tiles and the rows consistent for free, whereas a refetch-on-success would show
them disagreeing for a beat.

### Hide the delete action without permission, don't disable it

`permissions.delete` is a real field on the ABS user
(`packages/core/src/types/abs.ts:356`). A disabled control that never becomes
enabled is noise; where the account cannot delete, the action is absent. The 403
path is still handled, because permissions can change between page load and tap.

### Specify once, apply twice

The two `SessionsPage.tsx` copies differ in pagination and data shape, so this
change does not try to unify them - that is a larger piece of work. It specifies
the *behaviour* once and lists both files in Impact. Each repo wires its own API
layer: hosted through the target-scoped `absLibrary.ts` client, self-hosted
through the ambient `me.ts` client.

## Risks / Trade-offs

- **The re-ingest is load-bearing and undocumented by ABS.** It works because
  the local-session path upserts by id. If ABS changes that, edit breaks
  silently - the POST would insert a duplicate rather than error. Worth a
  post-write verification in testing, and worth noting that mobile carries the
  same exposure today.
- **Two implementations, one spec.** Nothing enforces that the copies stay in
  step. This is the drift problem in miniature; the mitigation is that the spec
  is the shared artifact, not the code.
- **Optimistic delete against a paginated list.** On the hosted app, removing a
  row from page 3 leaves that page one short until refetch. Acceptable - the
  alternative is re-fetching the page and losing scroll position for a
  single-row change.
