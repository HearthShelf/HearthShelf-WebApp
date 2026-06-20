# AGENTS.md

Guardrails for AI agents and contributors working in the HearthShelf hosted web
app (`app.hearthshelf.com`). This repo is **proprietary and closed-source**.
Treat these as hard rules.

## The one boundary that must never break

This app is an **arm's-length API client** of the user's HearthShelf /
AudiobookShelf server. It talks to those servers only over their public HTTP and
Socket interfaces.

It must **never** import, vendor, copy, link against, or derive from the source
of the AGPL-licensed HearthShelf repository. That separation is the entire legal
basis for this codebase being able to stay closed-source. If you need behavior
that exists in the AGPL repo, reach it over the API or reimplement it cleanly
here - never copy the code across.

Practical consequences:

- No `import` of AGPL repo modules, no git submodule of it, no copy-pasted
  functions or types from it.
- Shared knowledge travels as **API contracts** (request/response shapes), not
  as shared source.

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

Proprietary, all rights reserved (see `LICENSE.md`). No external contributions;
see `CONTRIBUTING.md`.
