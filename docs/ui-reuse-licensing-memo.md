# UI reuse vs licensing — decision memo

Status: **decision pending.** No license changed. Written 2026-06-24 to choose
how `app.hearthshelf.com` (proprietary WebApp) reuses the HearthShelf library UI
instead of maintaining a second, thinner copy.

## The problem

The WebApp is reimplementing a library/player UI from scratch (grid, search,
shelves, item detail, player) to stay proprietary — because importing the
**AGPL** HearthShelf UI would force the WebApp open (AGPL §13, "linking"
includes JS imports). Result: **two library views to maintain**, and the WebApp's
is a thin slice of what HearthShelf already has.

## What's actually in each repo (measured)

HearthShelf (`C:\code\HearthShelf`), current `main`:
- **~26,500 lines of UI** (`src/`) vs **~3,400 lines of server** (`server/`).
  It is overwhelmingly a frontend.
- UI surfaces already built there (far beyond the WebApp's slice): library,
  book + podcast detail, **player**, **reader** (ebooks), collections,
  playlists, series, narrators, search, Discover, QuestGiver, requests (RMAB),
  full settings/config, onboarding, stats.
- Server (`server/`, the only code with a plausible moat):
  - `lib/hosted.js`, `lib/oidc-setup.js`, `lib/context.js`, `routes/hosted.js`
    — hosted-mode auth broker / OIDC federation (the app.hearthshelf.com glue).
  - `routes/questgiver.js` + `providers.js` — AI recommendation gateway (holds
    the model key server-side).
  - `routes/rmab.js`, `routes/audible.js`, `routes/audplexus.js` — acquisition /
    catalog proxies.
  - `routes/discover.js`, `social.js`, `settings.js` — feature backends.
  - `lib/provision-aio.js`, `db.js` — AIO bootstrap + storage.

## Key licensing facts (verified)

- **HearthShelf is NOT a derivative of audiobookshelf.** README: "replacement
  UI/UX for AudiobookShelf"; AGENTS.md: "a user interface over a server the user
  runs." It talks to ABS over ABS's API; it does not contain ABS source. So its
  AGPL is a **choice**, not inherited — **you may relicense it.**
- **You own the copyright.** Git authors are only `Wutname1` and `dependabot`
  (version bumps, non-authorial). No third-party human contributors to clear.
- **CONTRIBUTING.md already reserves a relicense right** ("the maintainer may...
  distribute under other license terms"), so future contributors can't block it.
- **AGPL is viral; MIT is not.** You cannot pull AGPL code into an MIT/proprietary
  app and have the result be MIT/proprietary — the combined work owes AGPL. Flow
  only works AGPL←MIT, never MIT←AGPL. So the WebApp can only import HearthShelf
  UI if that UI is **not** AGPL.
- **The AIO image is AGPL-bound no matter what.** It bundles audiobookshelf
  (AGPL). Relicensing *your* code doesn't touch ABS; distributing the AIO image
  still distributes AGPL software and carries AGPL obligations. This is true
  under every option below — it is not a differentiator.

## The moat question (the real decision)

AGPL on HearthShelf stops a competitor from taking it, closing it, and running a
rival hosted service without contributing back — directly relevant because **you
are building exactly such a hosted service.** But the moat that matters is the
**server/gateway code (~3.4k lines)**, not the UI (~26.5k lines). The UI is
commodity presentation; the hosted-mode broker + AI gateway is the differentiated
part.

So the question is narrow: **is it acceptable for the ~26.5k-line UI to be
permissively licensed (reusable, incl. by competitors), while keeping the
~3.4k-line server moat protected?** Almost certainly yes — the UI being copyable
costs little; the gateway being copyable is what would hurt.

## Options

### A. Relicense the ENTIRE HearthShelf repo to MIT
- WebApp imports anything directly (monorepo path or git dep). One view.
- **Gives away the server moat too** — competitors can close-source your
  gateway/hosted-mode/QuestGiver code. Trades the valuable part to share the
  cheap part. Not recommended given you monetize the hosted service.

### B. Split licenses WITHIN the HearthShelf repo: UI MIT, server AGPL
- Relicense `src/` (UI) to MIT; keep `server/` AGPL. The WebApp imports the MIT
  UI; the gateway stays protected. One view, moat kept.
- No third package to manage (rejected by you) — it's a per-directory license
  split in the existing repo, declared in LICENSE + per-folder headers/READMEs.
- Caveats to validate before doing it:
  - The UI must not statically import any AGPL `server/` code. It talks to the
    backend over HTTP (it already does — `src/api/*` uses fetch), so this holds,
    but confirm no `src/` file imports from `server/`.
  - The WebApp would consume `src/` components either as a git dependency or by
    pulling that repo into a monorepo. Either way it imports only MIT code.
  - "Dual-license one repo by directory" is unusual but legitimate when you own
    the copyright; needs clear license boundaries so it's unambiguous which files
    are which.

### C. Status quo — keep two views, share only API contracts
- HearthShelf fully AGPL; WebApp fully proprietary; only request/response shapes
  cross. Bulletproof boundary, per-context UIs, but **two views forever** and the
  WebApp's stays a thin reimplementation of a much richer HearthShelf UI.

## Recommendation

**Option B** fits the stated goals best: one library view, no extra package to
manage, server moat intact, WebApp stays proprietary. It hinges on one
verifiable fact (UI has no static import of `server/`) and a clean license
boundary declaration. **Option A** only makes sense if the gateway moat doesn't
matter to you. **Option C** is the safe do-nothing if the import mechanics or the
per-directory split feel too fiddly.

## Open items to resolve before any change

1. Confirm `src/` has zero static imports from `server/` (HTTP-only boundary).
2. Decide WebApp consumption mechanism for the MIT UI: monorepo vs git dep vs
   copying-with-attribution (copying MIT code into the proprietary app is allowed
   and needs only attribution — and notably means **no shared build at all**).
3. Decide how much of the rich UI the WebApp actually wants (it needs the
   multi-server shell regardless; the per-server library/player/reader is what's
   reusable).
4. Confirm the dual-license declaration mechanics (LICENSE files + per-directory
   notices) with whatever counsel you use.
