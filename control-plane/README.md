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
