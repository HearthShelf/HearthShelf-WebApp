# AGENTS.md

> **NAMING (hard rule): never write or say "hs.direct".** We do not own that
> domain. The remote-access feature is the **connect domain**. The current zone
> is **`d.hearthshelf.com`**; a dedicated connect domain will be registered
> later. Always read the zone from config - never hardcode a domain literal. Real
> hostnames are synthesized as `<ip-dashed>.<hash>.<zone>`; the cert is
> `*.<hash>.<zone>`.

Guardrails for AI agents and contributors working in the HearthShelf hosted web
app (`app.hearthshelf.com`). This repo is **open source under AGPL-3.0**, the
same license as the HearthShelf server. Treat these as hard rules.

## How this relates to the HearthShelf server

This app talks to the user's HearthShelf / AudiobookShelf server over its public
HTTP and Socket interfaces. Both this repo and the HearthShelf server repo are
**AGPL-3.0**, so code may be **shared or reused between them** - there is no
arm's-length boundary anymore (that earlier rule existed only to keep this repo
closed-source, which is no longer a goal).

Reuse notes:

- You MAY import, copy (with attribution + license headers preserved), or share
  components/utilities with the AGPL HearthShelf repo. Prefer reuse over
  re-implementation to avoid maintaining two copies of the same UI.
- Anything reused or copied stays **AGPL-3.0**; keep license/copyright notices
  intact.
- Do NOT pull in code under a license incompatible with AGPL-3.0 (e.g. you
  cannot vendor proprietary or AGPL-incompatible third-party source).
- audiobookshelf (ABS) is also AGPL-3.0; reaching it is still over its API
  (ABS stays internal behind the HS gateway), but that's an architecture choice,
  not a licensing constraint.

## Monetization note

AGPL does not prevent running `app.hearthshelf.com` as a paid hosted service -
the copyright holder may charge to operate it. AGPL §13 does require offering the
**complete source of this app** to anyone who uses it over the network (see the
"Source" link in the app). Keep that offer working and the public repo current.

## Positioning guardrails (same as the open-source project)

HearthShelf is a UI. It does not host, source, or distribute content.

- No copy, UI label, or code that describes HearthShelf as a way to obtain
  content for free. Banned framings: "free books," "pirate," "torrent," "get any
  book," "download for free."
- Acquisition/request integrations are user-supplied, opt-in, and
  source-agnostic. Describe them as neutral plumbing.
- Keep the "you are responsible for the content you add and the backends you
  connect" disclaimer in user-facing surfaces.

## License

**AGPL-3.0** (see `LICENSE.md`). Contributions welcome under the same license
with DCO sign-off; see `CONTRIBUTING.md`.

## Related repositories

HearthShelf spans several repos. The servers are AGPLv3; the mobile app and the
shared `@hearthshelf/core` library are MIT (low-friction for a client app + a
shared lib that links cleanly into the AGPL servers).

| Repo | What it is | License |
| --- | --- | --- |
| **HearthShelf** | Self-hosted SPA + Node backend (`server/`) + Docker | AGPLv3 |
| **HearthShelf-WebApp** | Hosted front door (`app.hearthshelf.com`): SPA + control-plane Worker | AGPLv3 |
| **HearthShelf-Mobile** | Mobile app (Expo/React Native); Android Auto via a native Media3 `MediaLibraryService` | MIT |
| **HearthShelf-Core** | `@hearthshelf/core`: shared ABS types + pure logic, consumed as a git submodule | MIT |
| **HearthShelf-Website** | Marketing site (`hearthshelf.com`) |
| **HearthShelf-Docs** | Docs site (`docs.hearthshelf.com`) |
| **HearthShelf-Direct-Infra** | VPS-side infra for the connect domain (automatic HTTPS for self-hosters) |
| **HearthShelf-DesignSystem** | Logos, favicon, shared design assets |
