# HearthShelf MCP server

A remote [Model Context Protocol](https://modelcontextprotocol.io) server that
lets any MCP client (Claude desktop/web/mobile, and others) read a signed-in
user's HearthShelf library, reading history and recommendations - so the user can
ask *"does this book fit me?"*, *"what should I read next?"* or *"do I already
own this?"* in their AI client of choice.

Deployed at `https://mcp.hearthshelf.com`; the MCP endpoint is `/mcp`.

## Why this exists (and why it is free)

A "ask if a book fits me" button inside Discover would mean **we** pay for
inference on every question. This inverts that: the user's own AI subscription
pays for all reasoning, and this Worker only ships structured JSON.

That is a hard design rule, not an implementation detail:

> **This Worker never calls an LLM.** Every tool returns facts. The *client's*
> model does the reasoning. Adding an AI API call here would re-introduce exactly
> the cost this feature exists to avoid.

## Read-only, on purpose

There is no tool here that can mutate a library, and no write scope to request.
Book metadata is untrusted text that flows into a model's context window, so a
prompt-injected model must not be able to reach anything destructive. Keep it
that way.

## Tools

| Tool | What it returns |
|---|---|
| `list_servers` | The servers this user has linked |
| `list_libraries` | Libraries on a server, with ids and media types |
| `search_library` | Books matching a title/author/narrator query |
| `get_book` | One item in full: description, series, genres, progress |
| `get_reading_history` | Finished books, newest first - the best taste signal |
| `get_in_progress` | Currently reading/listening, with percent complete |
| `get_listening_stats` | Totals and recent daily activity |
| `get_recommendations` | HearthShelf's own Discover picks for this user |
| `find_similar` | Neighbours **in the user's own library** for a given book |

Every tool takes an optional `server_id`. Users with one linked server can omit
it; users with several get an error naming the available ids.

## Auth

The Worker is an OAuth 2.1 **resource server** and authorization server, with
Clerk as the upstream identity provider. It implements the discovery chain the
MCP spec requires (RFC 9728 protected-resource metadata, RFC 8414 auth-server
metadata, PKCE S256, RFC 7591 dynamic client registration), which is what makes
one-click connection possible: the user pastes no token and edits no config.

```
Claude ──1── POST /mcp (no token)
       ◄─2── 401 + WWW-Authenticate: resource_metadata=...
       ──3── GET /.well-known/oauth-protected-resource/mcp
       ──4── GET /.well-known/oauth-authorization-server
       ──5── POST /register            (dynamic client registration)
       ──6── GET /authorize            ──► app.hearthshelf.com/connect-ai
                                            (Clerk sign-in, then POSTs a
                                             session token to /callback)
       ◄─7── consent screen ─► POST /approve ─► redirect with auth code
       ──8── POST /token               (PKCE verifier)
       ──9── POST /mcp with access token ✓
```

The grant's encrypted props carry the Clerk identity. At tool-call time the
Worker mints a short-TTL grant from the control plane and redeems it at the
user's box for a per-user ABS token - exactly what the SPA does in
`src/lib/connectServer.ts`. **No long-lived ABS credential is stored**; the
redeemed token is cached in Durable Object memory only, for
`ABS_TOKEN_TTL_SECONDS` (default 10 min).

### Known limitation: session-token lifetime

The Clerk session token captured at authorize time is what authenticates the
Worker to the control plane later. Clerk session tokens expire, so a connection
will eventually need re-authorizing; tools surface this as *"Your HearthShelf
connection has expired. Reconnect the HearthShelf connector..."* rather than a
raw 401.

Replacing this with a control-plane-issued long-lived MCP credential is the
tracked follow-up. It needs a new control-plane endpoint, so it was deliberately
left out of the first cut - see `McpProps.clerkToken` in `src/types.ts`.

## Setup

```bash
npm install
```

Create the KV namespace the OAuth provider needs, and put the returned id in
`wrangler.toml`:

```bash
npx wrangler kv namespace create hearthshelf-mcp-oauth
```

Set the cookie-encryption secret:

```bash
npx wrangler secret put COOKIE_ENCRYPTION_KEY
```

Deploy:

```bash
npx wrangler deploy
```

The custom domain (`mcp.hearthshelf.com`) is attached out of band in the
Cloudflare dashboard, the same as `api.hearthshelf.com` and
`logs.hearthshelf.com` - deliberately not a `[[routes]]` block, because the CI
deploy token is not scoped to zone Workers Routes.

### Local development

```bash
npx wrangler dev --port 8799 --local
```

The discovery surface can be exercised without Clerk:

```bash
curl -s http://127.0.0.1:8799/.well-known/oauth-protected-resource/mcp
```

Completing a full authorization locally needs a Clerk session, which production
Clerk keys will not issue to `localhost`. The SPA side has a dev harness at
`/dev/connect-ai` for the no-session branches.

## Connecting from Claude

Add a custom connector with the URL:

```
https://mcp.hearthshelf.com/mcp
```

Claude registers itself, opens the sign-in bounce, and shows the consent screen.

## Layout

```
src/
  index.ts            OAuthProvider wiring + Worker entry
  authorize.ts        sign-in bounce, consent screen, grant completion
  mcp.ts              the McpAgent: tool registration + error shaping
  types.ts            Env bindings + the encrypted grant props
  lib/
    clerk.ts          Clerk session verification (mirrors the control plane)
    controlPlane.ts   list servers, mint grants, redeem at a box
    absClient.ts      per-session ABS access + short-TTL token cache
  tools/
    library.ts        the actual ABS/HearthShelf reads behind each tool
```
