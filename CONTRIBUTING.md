# Contributing

This repository is the **proprietary, closed-source** hosted HearthShelf web
application. It is not open source and does not accept external contributions.

If you are looking to contribute to HearthShelf, contribute to the open-source,
self-hostable project instead - it is licensed under the AGPLv3 and welcomes
contributions under a DCO sign-off. See that repository's `CONTRIBUTING.md`.

## For internal contributors

- This app must stay an **arm's-length API client** of the public HearthShelf /
  AudiobookShelf HTTP and Socket APIs. Never import, vendor, or link source from
  the AGPL-licensed HearthShelf repository - doing so would entangle this
  codebase with the AGPL. See [AGENTS.md](AGENTS.md).
- Respect the same positioning guardrails as the open-source project: no copy,
  UI, or code that describes HearthShelf as a way to obtain content for free.
