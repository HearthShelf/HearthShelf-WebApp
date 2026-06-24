# HearthShelf WebApp

The hosted HearthShelf web application - a unified front door (think
`app.hearthshelf.com`) that lets a HearthShelf user reach their own
self-hosted AudiobookShelf server through a single URL, in the same spirit as
`app.plex.tv`.

This is **not** the self-hostable HearthShelf container. This repository is the
hosted front door (SPA + control-plane Worker). The self-hostable HearthShelf
(SPA + QuestGiver backend) lives in its own repository. Both are AGPL-3.0.

## Relationship to the HearthShelf server

This app talks to the user's HearthShelf / AudiobookShelf server over its public
HTTP and Socket interfaces. Because this app and the HearthShelf server are both
**AGPL-3.0**, code may be shared or reused between them - prefer reuse over
maintaining a duplicate UI. Keep license/copyright notices intact on anything
brought across.

See [AGENTS.md](AGENTS.md) for the full guardrails.

## License

**GNU AGPL-3.0** - see [LICENSE.md](LICENSE.md). The AGPL network clause
(section 13) means anyone who uses the hosted service is entitled to this app's
complete source; a "Source" link is provided in the app. Running it as a paid
hosted service is permitted.

## Legal / disclaimer

HearthShelf is a user interface. It does not host, store, distribute, or
source any audiobooks, ebooks, or other content, and it is not affiliated with
AudiobookShelf.

**You are responsible for the legality of any content you add to your library
and for any backends or services you connect to HearthShelf.** HearthShelf
provides the plumbing to talk to servers and services you configure; it does
not provide content and is not a means of obtaining it.
