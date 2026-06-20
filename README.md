# HearthShelf WebApp

The hosted HearthShelf web application - a unified front door (think
`app.hearthshelf.com`) that lets a HearthShelf user reach their own
self-hosted AudiobookShelf server through a single URL, in the same spirit as
`app.plex.tv`.

This is **not** the self-hostable HearthShelf container. This repository is the
proprietary, closed-source hosted control plane. The open-source,
self-hostable HearthShelf (SPA + QuestGiver backend) lives in its own
repository under the AGPLv3.

## Architecture boundary (read before adding code)

This app must remain an **arm's-length API client** of the user's HearthShelf /
AudiobookShelf server. It talks to those servers only over their public HTTP
and Socket interfaces - the same way any other client does.

It must **never** import, vendor, link against, or copy source from the
AGPL-licensed HearthShelf repository. Keeping this boundary clean is what keeps
this codebase independent of the AGPL and able to stay closed-source. If you
find yourself wanting to reuse AGPL code here, expose it over the API instead.

See [AGENTS.md](AGENTS.md) for the full guardrails.

## License

Proprietary. All rights reserved. See [LICENSE.md](LICENSE.md).

## Legal / disclaimer

HearthShelf is a user interface. It does not host, store, distribute, or
source any audiobooks, ebooks, or other content, and it is not affiliated with
AudiobookShelf.

**You are responsible for the legality of any content you add to your library
and for any backends or services you connect to HearthShelf.** HearthShelf
provides the plumbing to talk to servers and services you configure; it does
not provide content and is not a means of obtaining it.
