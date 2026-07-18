# HearthShelf Control Plane

A Cloudflare Worker (Hono + D1) that is the brain behind `app.hearthshelf.com`.
It links a Clerk identity to the self-hosted HearthShelf servers that identity
may reach, runs the pairing-code exchange, and mints short-lived **signed grant
assertions** the client redeems with an HS server directly.

It never stores ABS credentials and is never in the data path. See
[../ARCHITECTURE.md](../ARCHITECTURE.md) for the full trust model.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | liveness |
| GET | `/.well-known/jwks.json` | none | public signing keys (HS verifies grants offline) |
| POST | `/pairing/start` | server secret (returned here) | HS server begins pairing; returns code + secret + key URLs |
| POST | `/pairing/redeem` | Clerk | user redeems a code to link a server |
| GET | `/servers` | Clerk | list the user's linked servers |
| POST | `/servers/:id/grant` | Clerk | mint a short-TTL grant for one server |
| DELETE | `/servers/:id` | Clerk | unlink a server |

## Error codes

Failures answer with `{ "error": "<code>" }` (plus an optional `detail` for
logs) and an HTTP status. The `error` is a stable machine code, never
user-facing copy - the client (`app.hearthshelf.com`) maps it to a friendly
message in `src/lib/errorMessages.ts`. **When you add a new code here, add a
matching line there** so users see plain language instead of the raw token.

| Code | Typical status | Meaning |
|---|---|---|
| `unauthorized` | 401 | No valid Clerk session on a call that needs one. |
| `email_unverified` | 403 | The Clerk identity's email isn't verified yet. |
| `forbidden` | 403 | Authenticated but not allowed (e.g. not this server's admin, not a platform admin). |
| `not_linked` | 403 | The signed-in user isn't linked to the target server. |
| `bad_pin` / `pin_required` | 401 / 403 | Account-switch PIN missing or wrong. |
| `locked_out` | 410 | Too many wrong PINs; the remembered handle was revoked. |
| `unknown_handle` | 404 | Account-switch handle is unknown/expired. |
| `bad_server_secret` | 401 | A server-to-CP call presented a wrong/rotated server secret. |
| `invalid_token` | 400 | Invite token is malformed or unrecognized. |
| `invalid_grant` | 401 | A signed grant assertion failed verification. |
| `server_unknown` / `unknown_server` | 404 | No server with that id. |
| `invite_not_found` | 404 | Invite id/token doesn't resolve. |
| `already_paired` | 409 | Pairing start for a server that's already linked. |
| `invalid_code` | 400 | Pairing code is malformed or unknown. |
| `code_already_used` | 409 | Pairing code was already redeemed. |
| `code_expired` | 410 | Pairing code's TTL elapsed. |
| `rate_limited` | 429 | Too many attempts; back off and retry. |
| `public_url_invalid` | 400 | Submitted public URL isn't a usable https origin. |
| `public_url_not_reachable` | 422 | CP couldn't reach the submitted public URL from outside. |
| `hsdirect_not_configured` | 409 | Server asked for hs.direct work but has no hs.direct record. |
| `name_too_short` | 400 | Server display name below the minimum length. |
| `quota_exceeded` | 429 | Server hit its monthly email-relay cap. |
| `send_failed` | 502 | Email relay couldn't hand off to the mail provider. |
| `invalid_to` / `invalid_email` | 400 | Recipient address is malformed. |
| `subject_required` / `body_required` | 400 | Email relay call missing subject/body. |
| `cannot_remove_self` | 400 | A platform admin tried to remove their own admin row. |
| `cannot_remove_last_admin` | 400 | Would remove the last platform admin. |
| `no_version` | 400 | Release-publish call with no version. |
| `clerk_delete_failed` | 500 | Account data was purged but the Clerk identity delete failed (see the caller's user-facing note). |
| `collector_unavailable` | 503 | The isolated log collector is unreachable. |
| `bad_id` | 400 | A path/body id failed validation. |
| `invalid_body` / `bad_body` / `bad_request` / `invalid_payload` | 400 | Request body failed validation. |
| `not_found` | 404 | Unknown route or resource. |
| `not_implemented` | 501 | Endpoint is a stub / not built yet. |
| `server_error` | 500 | Unhandled failure (the catch-all). |

## Local development

```bash
npm install
node scripts/gen-signing-key.mjs      # generate a dev Ed25519 key
# put the printed private JWK in .dev.vars as CP_SIGNING_JWK=...
npm run db:migrate:local              # apply D1 migrations to local sim
npm run dev                           # wrangler dev (Miniflare, local D1)
```

`.dev.vars` (gitignored) holds local secrets:

```
CP_SIGNING_JWK={"crv":"Ed25519",...}
```

Verified locally end-to-end: `/health`, JWKS, `/pairing/start`, auth gating, and
the grant sign -> JWKS-verify chain (including tamper + wrong-audience
rejection).

## One-time production setup (needs Cloudflare + Clerk accounts)

These run once by hand; ongoing deploys are automated (see below).

1. **Create the D1 database** and paste its id into `wrangler.toml`:
   ```bash
   wrangler d1 create hearthshelf-control-plane
   ```
2. **Signing key secret**:
   ```bash
   node scripts/gen-signing-key.mjs
   wrangler secret put CP_SIGNING_JWK   # paste the private JWK
   ```
3. **Clerk**: set `CLERK_JWKS_URL` (your Clerk instance JWKS) in `wrangler.toml`
   vars or as a secret. Add a Clerk **JWT template** that includes verified
   `email` and `email_verified` claims (the grant matches the ABS user by
   verified email). If your claim names differ, adjust `src/lib/clerk.ts`.
4. **CP_ISSUER**: set to the deployed Worker's public URL.

## CI/CD (GitHub Actions)

Deploys are automated - no more manual `wrangler deploy`.

- **`.github/workflows/control-plane-ci.yml`** - typechecks the Worker on every
  PR that touches `control-plane/**`.
- **`.github/workflows/control-plane-deploy.yml`** - on push to `main` touching
  `control-plane/**` (or manual run): typecheck -> apply D1 migrations
  (`--remote`) -> `wrangler deploy`.

**Required GitHub repo secrets** (Settings -> Secrets and variables -> Actions):

| Secret | What |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with **Workers Scripts: Edit** and **D1: Edit** on the account |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account id |

`CP_SIGNING_JWK` stays a **Worker secret** (`wrangler secret put`), not a GitHub
secret - the pipeline never touches it.

## Notes

- **Grants are short-lived** (`GRANT_TTL_SECONDS`, default 300s). Revocation =
  expiry: unlinking a server stops new grants; existing ones die within the TTL.
- **Key rotation**: the `signing_keys` table + JWKS-by-kid design supports
  publishing multiple public keys while one signs. Rotation tooling is a TODO.
- **First redeemer is the server admin**; later invitees default to `user`.
