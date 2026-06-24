# Contributing to HearthShelf WebApp

Thanks for your interest in the HearthShelf hosted web app (`app.hearthshelf.com`).
This document covers how to contribute and the legal terms that apply.

## License of the project

This repo is licensed under the **GNU Affero General Public License v3.0**
(AGPLv3), the same license as the HearthShelf server. By contributing, you agree
that your contributions are licensed under the same license. See
[LICENSE.md](LICENSE.md).

Because this app and the HearthShelf server are both AGPL-3.0, code may be shared
or reused between the two repos. Keep license and copyright notices intact on
anything you bring across, and do not introduce code under an AGPL-incompatible
license.

## Developer Certificate of Origin (DCO)

To keep the project's provenance clean - and to keep the door open for the
hosted service to be offered under additional license terms in the future -
every contribution must be signed off under the
[Developer Certificate of Origin 1.1](https://developercertificate.org/).

The DCO is a lightweight statement that you wrote the patch or otherwise have the
right to submit it under the project's license. Its full text:

```
Developer Certificate of Origin
Version 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

### How to sign off

Add a `Signed-off-by` line to each commit message, using your real name and a
real email address:

```
Signed-off-by: Jane Developer <jane@example.com>
```

Git can add this automatically with the `-s` flag:

```bash
git commit -s -m "fixes: faster shelf rendering"
```

Pull requests whose commits are not signed off cannot be merged.

## What you're agreeing to

By signing off, you affirm the DCO above. You retain copyright in your
contribution; you grant it to the project under the AGPLv3, and you confirm you
have the right to do so. You also acknowledge that the maintainer may, in
addition to the AGPLv3, distribute the project (including your contribution)
under other license terms - for example as part of a hosted service. If you
cannot agree to that, do not submit a contribution.

## Commit message format

This repo's history uses `feat:` / `fix:` / `docs:` style prefixes. Either that
or the HearthShelf server's `new:` / `improved:` / `fixes:` style is fine; keep
the first line about user impact and put technical detail in the body.

## Scope and positioning

This app is the multi-server front door over HearthShelf / AudiobookShelf servers
the user runs. Contributions must respect the project's positioning:

- HearthShelf does not host, source, or distribute content.
- Any integration that talks to an external service must be **opt-in and
  unconfigured by default**, and **source-agnostic** - the user supplies and is
  responsible for the backend.
- No code, comment, commit message, or user-facing text may describe, imply, or
  encourage obtaining content the user is not entitled to.

See [AGENTS.md](AGENTS.md) for the full guardrails.
