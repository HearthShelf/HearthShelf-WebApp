## 1. API layer

- [ ] 1.1 WebApp: add `deleteListeningSession(t, sessionId)` and
      `updateListeningSession(t, session)` to `src/api/absLibrary.ts`, beside the
      existing `getListeningSessions`. Port the re-ingest comment from
      `HearthShelf-Mobile/src/api/abs.ts:463-471` - the POST-to-`/api/session/local`
      trick is not obvious and must not be re-derived later.
- [ ] 1.2 HearthShelf: same two functions in `src/api/me.ts`, ambient-token
      style.
- [ ] 1.3 Surface the account's `permissions.delete` on both. Confirm where each
      app already holds the ABS user before adding a fetch.

## 2. Row actions

- [ ] 2.1 Add a per-row action affordance to both `SessionsPage.tsx` copies,
      matching each app's existing menu idiom.
- [ ] 2.2 Delete: confirm naming the book and session date, then delete.
- [ ] 2.3 Edit duration: a small dialog seeded with the current duration,
      accepting a corrected value. Duration only - the ingest honours nothing
      else.
- [ ] 2.4 Omit the delete action when the account lacks delete permission.

## 3. List and totals

- [ ] 3.1 Apply both writes optimistically; roll back and surface the error on
      failure.
- [ ] 3.2 Ensure the four summary tiles derive from the current list so they
      recompute on delete and on edit.
- [ ] 3.3 Handle a 403 from delete distinctly from a network failure - the user
      is told they cannot delete, not that something broke.

## 4. Verify

- [ ] 4.1 Typecheck and build both repos.
- [ ] 4.2 Delete a session; confirm it disappears, the tiles recompute, and it
      is still gone after a reload.
- [ ] 4.3 Edit a duration; confirm the row updates AND that a reload shows one
      session, not two - the re-ingest upserting by id is the whole basis of the
      edit path and is the thing most likely to break.
- [ ] 4.4 With a non-delete-permission account, confirm the action is absent.
- [ ] 4.5 Force a failing write; confirm the row returns and the error is shown.
- [ ] 4.6 Confirm both apps present the same actions, labels and confirmations.
