# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: the invited listener.** Someone a self-hoster handed a link to -
often family or a friend, usually not technical. They never think about servers,
ports, or containers; they open `app.hearthshelf.com`, find a book, and listen.
Their situation is everyday and mobile: a phone in a kitchen, a browser tab at a
desk, a car head unit. The listening and browsing experience is the product for
them.

**Secondary: the host / server admin.** The person who actually runs the
HearthShelf or AudiobookShelf box. They evaluate and adopt the product, invite
the listeners, and administer the server - and they listen on it too. They need
dense, complete control surfaces (`/config`, `/admin`), but those are a minority
path that must never crowd the listener's experience.

Design center of gravity is the listener; the admin is a real audience with its
own surfaces, not an afterthought.

## Product Purpose

`app.hearthshelf.com` is a hosted front door that lets anyone reach any
HearthShelf / AudiobookShelf server they have access to through a single URL -
the `app.plex.tv` model for audiobooks and ebooks. It is a user interface only:
it does not host, store, source, or distribute content.

Success is a listener who never has to know a server exists, and a host who
never has to send anyone a raw IP address.

## Positioning

Three claims a neighboring product could not truthfully copy:

1. **It feels warm, not like a NAS panel.** The bare AudiobookShelf web UI is a
   competent server dashboard. This is a reading and listening room - calm, warm
   near-neutrals on a hearth palette, craft in the details. Atmosphere is a
   feature here, not decoration.
2. **One front door to any server.** A single hosted URL reaches any server the
   user has access to, from anywhere, without VPN or port-forwarding ceremony.
3. **A discovery and social layer a bare media server does not have.**
   QuestGiver recommendations, book clubs, the upcoming-releases roster,
   narrator pages, re-read stats, and requests exist on top of the library, not
   beside it.

These are the durable differentiators. Design work that makes the app read as a
generic media-server admin panel contradicts (1) and is wrong regardless of how
tidy it looks.

## Operating Context

- Reached in a browser on phone, tablet, desktop, and car head units. There is a
  dedicated large-touchscreen **car shell** for the player and navigation.
- Talks to the user's own HearthShelf / AudiobookShelf server over its public
  HTTP and Socket interfaces. The active server is ambient - it is not carried in
  the URL, and a user may have several linked.
- Surfaces span library browsing, item/author/series/narrator detail,
  collections and playlists, podcasts, search, upload, a player and an epub
  reader, stats and profiles, clubs, upcoming releases, requests, account and
  server linking, the full server admin panel (`/config`), and a platform-admin
  area (`/admin`).
- Sign-in is hosted (Clerk); servers are linked to an account rather than logged
  into individually.

## Capabilities and Constraints

- **Feature-flag reality.** Large parts of the UI - QuestGiver, Discover,
  Requests, clubs, email, the connect domain - are per-server opt-in and may be
  entirely absent. Every surface must look deliberate and complete with the
  feature off, not like something failed to load.
- **Full parity with the self-hosted SPA.** This app is a 100% replacement for
  the local server UI, including the complete server admin panel. Nothing is
  deferred as "box-only."
- **Car / large-touch shell.** The player and navigation have a dedicated
  large-touchscreen mode. Design decisions must survive it.
- **Ambient active server.** Library surfaces render inside a shell that supplies
  the connected server; pages do not take a server id.
- Stack: React 19 + React Router 7 + TanStack Query + Zustand + Tailwind 4, Vite,
  Clerk auth, deployed as a Cloudflare Pages SPA alongside a control-plane
  Worker. Shared ABS types and pure logic come from the `@hearthshelf/core` git
  submodule at `packages/core`.

## Brand Commitments

- Name: **HearthShelf**. Logos, favicon, and shared design assets live in the
  sibling `HearthShelf-DesignSystem` repo.
- An established visual system is already committed in `src/styles/tokens.css`
  and `src/styles/design.css`: hearth palette on a warm `#1b1a18` base (never
  navy, never muddy brown), dark as home and light as a daytime option, brand
  gold + shelf cream lockup, with a separate functional ember accent that can be
  driven by cover art. Self-hosted Inter, Libre Baskerville, and Material Symbols
  Rounded faces - no external CDN, offline-safe.
- **Positioning guardrails are binding on all UI copy.** No label, string, or
  code may describe HearthShelf as a way to obtain content for free; banned
  framings include "free books," "pirate," "torrent," "get any book," and
  "download for free." Acquisition and request integrations are described as
  neutral, user-supplied, opt-in plumbing. The "you are responsible for the
  content you add and the backends you connect" disclaimer stays in user-facing
  surfaces.
- **Never write or say "hs.direct."** The remote-access feature is the **connect
  domain**; the zone is read from config, never hardcoded.
- AGPL-3.0. A working "Source" link must remain in the app (AGPL section 13).

## Evidence on Hand

- A large, real, shipped interface: ~40 top-level pages plus 25 admin config
  sections and a platform-admin area, with dev harnesses under `/dev/*`.
- Committed design tokens and stylesheet (`src/styles/`), self-hosted font files,
  favicon and flame mark in `public/`.
- Architecture and guardrail documentation: `ARCHITECTURE.md`, `AGENTS.md`,
  `README.md`, and design docs under `docs/` including `docs/mockups`.
- No testimonials, customer names, usage numbers, pricing, or benchmarks exist.
  Future work must not fabricate any. Hosting this as a paid service is permitted
  by the license but no pricing has been established.

## Product Principles

1. **The listener never meets the server.** Infrastructure - servers, pairing,
   tokens, flags - stays out of the listening path unless the user went looking
   for it.
2. **Warm room, not control panel.** When a layout could read as either a media
   server dashboard or a place someone wants to spend an evening, choose the
   latter. This is the differentiator, not a finish.
3. **Absence is a designed state.** A disabled feature, an empty shelf, or an
   unlinked server is a first-class screen, never a hole where a feature should
   be.
4. **Admin density is earned, not apologized for.** Control surfaces may be dense
   and complete; they should feel precise and native to the same world, not like
   a bolted-on panel.
5. **Say only what is true.** Copy never implies HearthShelf sources content, and
   never invents proof the product does not have.

## Accessibility & Inclusion

WCAG 2.1 AA is the floor across every surface: contrast, visible focus, keyboard
reachability, and respect for reduced-motion preferences.

The car / large-touch shell goes further: glanceable type sizes and hit targets
beyond the AA minimum, sized for a driver's peripheral glance rather than a
deliberate desktop click.
