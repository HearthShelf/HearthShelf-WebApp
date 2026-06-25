# hs.direct — implementation spec (Option B reachability)

Status: **design, follow-up.** This is the actionable build spec for the
`hs.direct`-style service described as **Option B** in
[`hosted-oidc-design.md`](./hosted-oidc-design.md) §7. It does not re-decide
anything — the approach, the domain plan, and the sequencing are already ratified
there (§7 "Domain decision (locked 2026-06-23)" and §12 item 4). This document
turns that decision into concrete components, contracts, and an order of work.

**Why this exists.** The hosted flow connects the browser **directly to the
self-hosted server's origin** (design §4.2, §4.3), so that origin must answer on
**HTTPS with a CA-valid certificate**. The MVP (Option A) requires the
self-hoster to bring their own domain + cert (reverse proxy / Cloudflare Tunnel /
DDNS — see HearthShelf-Docs `setup/remote-access.md`). That excludes the
"just runs on my LAN" crowd Plex serves with `*.plex.direct`. hs.direct closes
that gap by handing every server a working HTTPS hostname **automatically**.

**Sequencing (do not start before this is true).** Option A must be proven
end-to-end first: the pre-flight reachability check (`/reachability/check` +
`/hs/hosted/reachability`, shipped) and the OIDC auth path (design §13 steps
1-3). hs.direct only changes **how a server gets a reachable `public_url`**; it
plugs into the exact same `validatePublicUrl` / `probeServer` / pairing
machinery. Build it after the auth path renders a real library through a
bring-your-own-domain server.

---

## 1. The two halves (and their very different costs)

Per design §7, the mechanism splits cleanly. Keep them decoupled — they fail and
scale independently.

| Half | What it does | Cost | State |
| --- | --- | --- | --- |
| **DNS** | Resolve `<ip>.<hash>.<zone>` to `<ip>` by parsing the label | cheap | **stateless** — no records written |
| **Cert** | Give each server a wildcard cert for `*.<hash>.<zone>` | the real work | per-server key + renewal |

### 1.1 DNS half — stateless wildcard synthesis

A hostname encodes the target IP in its left label, hyphen-separated:

```
192-168-1-7.<server-hash>.<zone>      ->  A 192.168.1.7
203-0-113-9.<server-hash>.<zone>      ->  A 203.0.113.9
```

The responder parses the first label, validates it is four 0-255 octets, and
**synthesizes** the A answer. No per-server, per-IP, or per-user record is ever
written — any IP resolves instantly with zero provisioning. (This is the point
design §7 stresses: nothing is provisioned at the DNS layer.)

IPv6 variant (optional, later): encode with a reversible scheme in the label and
synthesize a AAAA. Not required for the POC.

**Runtime:** a Cloudflare Worker **cannot** serve raw DNS (UDP/53). This half
needs one of:
- a small always-on authoritative DNS service we run (tiny VM/container running
  e.g. CoreDNS with a synthesis plugin, or a ~100-line custom UDP responder), or
- a managed authoritative DNS that supports answer synthesis.

It holds **no state** and does **no I/O** beyond parsing — trivially horizontally
scalable, cache-friendly (long TTL on the synthesized answer).

**Zone delegation (POC):** delegate `d.hearthshelf.com` to the synthesis service
via `NS` records in the `hearthshelf.com` zone (design §7 POC plan). Server
hostnames become `192-168-1-7.<hash>.d.hearthshelf.com`.

**DNS-rebinding caveat (must document + mitigate downstream):** a synthesized
name can resolve to a **private IP** (that's the feature — LAN reachability).
That is textbook DNS-rebinding shape. Mitigations live at the consumers, not the
DNS layer: the control plane's `probeServer` already runs from the Worker (public
egress, can't reach private space), and any server-side fetch of a synthesized
host must refuse private-range answers. Note it explicitly wherever a synthesized
host is fetched.

### 1.2 Cert half — per-server wildcard via DNS-01

Each server gets **one** Let's Encrypt **wildcard** cert for `*.<hash>.<zone>`,
covering all of that server's possible IPs (they share the hash subdomain). The
**server holds its own private key** — we never hold it (parity with Plex; design
§7).

- **Challenge:** **DNS-01 is required** for wildcards (HTTP-01 cannot issue
  wildcards). The ACME client proves control of `<hash>.<zone>` by writing the
  `_acme-challenge.<hash>.<zone>` TXT record.
- **Who writes the TXT:** the `<zone>` is **ours**, so the control plane (which
  already brokers pairing) drives the DNS-01 challenge against our DNS provider's
  API (Cloudflare DNS API for the prod `.app` zone). The per-server ACME account
  + order is created at pairing; the server generates its keypair and CSR, the
  CP completes the DNS-01 challenge, the cert is issued, and the **private key
  never leaves the server**.
- **Key custody options (pick at build):**
  1. **Server-driven ACME (preferred):** the HS container runs the ACME client,
     generates its own key, and asks the CP only to satisfy the DNS-01 TXT for
     `<hash>.<zone>`. Key never transits the CP. More moving parts on the box.
  2. **CP-driven issuance with key handoff:** CP runs ACME but generates the key
     **on the server** via a CSR upload, so the CP signs an order for a key it
     never sees. Avoid any path where the CP holds the private key.
- **Renewal:** wildcard certs are ~90-day; renew at ~60 days. Renewal re-runs
  DNS-01 (same broker path). This is the ongoing ops cost — automate it on the
  server with CP assistance for the TXT record.

---

## 2. Where it plugs into the existing flow

hs.direct produces a `public_url`; everything downstream is unchanged.

1. **Hostname → `PUBLIC_URL`.** At claim time the server computes its hostname
   `<current-ip>.<hash>.<zone>` and sets `PUBLIC_URL=https://<that host>`. For a
   server with multiple/changing IPs, the *hash subdomain* is stable; the IP
   label updates as the IP changes (the cert is a wildcard, so it keeps
   validating). The AIO container serves the cert on its ingress (nginx) — new
   work: nginx must load a runtime-provisioned cert + key, not just plain :80.
2. **`validatePublicUrl` (control-plane/src/lib/reachability.ts).** A
   `*.hearthshelf.app` host **passes today** (https, has dots, not a bare IP). No
   change needed — confirm the hash/zone format always has a dot and is never a
   bare IP. The synthesized A may be private, but validation is about the *URL
   shape*, and the probe (next) handles liveness.
3. **`probeServer`.** Runs from the Worker, so it only confirms **public**
   reachability — a LAN-only server will read `offline` from the CP even though
   the owner can reach it. That's acceptable (advisory), but the picker status
   semantics should distinguish "unreachable from internet" from "down" for
   hs.direct hosts. Track as a follow-up to the status endpoint.
4. **Per-server Clerk `redirect_uri` (pairing.ts `absRedirectUri`).** The OIDC
   client's pinned redirect must be `<public_url>/auth/openid/callback`. With
   hs.direct the public_url's **IP label can change**, which would break a pinned
   redirect. Resolve by pinning the redirect to a **stable** hs.direct hostname
   (e.g. a canonical `<hash>.<zone>` form or a fixed label) rather than the
   IP-bearing label, so the cert wildcard and the redirect both survive IP
   changes. This is the one real design subtlety hs.direct adds to the auth path —
   settle it before issuing clients for hs.direct servers.

   **RESOLVED (verified 2026-06-24).** Pinning a stable value on Clerk is
   *necessary but not sufficient* — ABS does not use whatever we pinned, it builds
   the redirect_uri itself from the **inbound `Host` header**:
   `OidcAuthStrategy.js:292-293` derives `hostUrl` from `req.get('host')` (and
   `x-forwarded-proto`), then `:327` builds
   `new URL('/auth/openid/callback', hostUrl)`. And `HearthShelf/nginx/abs_proxy.conf`
   sets **both** `proxy_set_header Host $host` (line 6) and
   `X-Forwarded-Host $host` (line 9) to `$host` — the **raw inbound Host header**,
   *not* `PUBLIC_URL`'s host. So for an hs.direct server the browser hits
   `https://<ip-label>.<hash>.<zone>/auth/openid`, the inbound `Host` is the
   IP-bearing name, and ABS emits a redirect_uri carrying that IP label — which
   will not match the single pinned Clerk allowlist entry the moment the IP
   changes. The callback then fails with `redirect_uri` mismatch.

   The fix is in **two places, and both are required:**
   - **Clerk side:** pin the redirect to the stable canonical host
     `https://<hash>.<zone>/auth/openid/callback` (a fixed, non-IP label form), set
     in `absRedirectUri` for hs.direct servers.
   - **nginx side (the load-bearing half):** for hs.direct servers, ABS must *see*
     that stable host. Override `Host`/`X-Forwarded-Host` to the stable
     `<hash>.<zone>` (driven by `PUBLIC_URL`'s canonical host) instead of `$host`,
     so ABS's `req.get('host')` yields the stable name regardless of which
     IP-bearing label the browser used. Without this nginx change, the Clerk pin is
     cosmetic and every IP change breaks the callback.

   This makes §2.4 and §5 (§12.3) the **same fix**: route ABS's notion of its own
   host through the stable `PUBLIC_URL` host, not the inbound `$host`.

---

## 3. POC → production

Per design §7 (locked):

- **POC:** zone `d.hearthshelf.com`, certs `*.<hash>.d.hearthshelf.com`. Zero new
  spend, proves DNS synthesis + DNS-01 + nginx cert loading end-to-end.
- **Production:** dedicated **`.app`** domain (lean `hearthshelf.app`) registered
  via **Cloudflare**, for Public-Suffix-List isolation from `hearthshelf.com` /
  `clerk.hearthshelf.com` (the rebinding-prone synthesized names and any cookies
  sit on a different registrable domain) and `.app`'s HSTS-preload. ~$14/yr.
- **The swap is a config change:** the synthesis service's `<zone>` and the cert
  base. The per-server pairing/issuance flow is identical. No code fork.

---

## 4. Build order

0. **Prereq:** Option A auth path proven end-to-end (design §13 steps 1-3) —
   reachability check is already shipped.
1. **DNS synthesis service** + delegate `d.hearthshelf.com`. Verifiable in
   isolation: `dig 192-168-1-7.test.d.hearthshelf.com` returns `192.168.1.7`.
2. **DNS-01 broker** in the control plane: per-server ACME order + TXT write
   against our zone; issue a wildcard for `*.<hash>.d.hearthshelf.com`. Verify a
   cert issues for a throwaway hash.
3. **Server cert custody + nginx serving:** the HS/AIO container generates its
   key, obtains the cert (via the broker), and nginx serves HTTPS on it. Verify
   `curl https://<ip>.<hash>.d.hearthshelf.com/healthcheck` from off-LAN.
4. **Pairing integration:** compute hostname → `PUBLIC_URL`; pin the per-server
   Clerk redirect to the **stable** hs.direct host (§2.4); **and** override
   `Host`/`X-Forwarded-Host` in nginx to that stable host for hs.direct mode (§5 /
   §12.3 — verified required, not optional: ABS builds redirect_uri from the
   inbound Host, which is the changing IP label otherwise). Run the existing
   reachability check against it.
5. **Renewal automation** (~60-day) + **private-IP refusal** on any server-side
   fetch of a synthesized host (§1.1 caveat).
6. **Production swap** to `hearthshelf.app` (config-only).

---

## 5. Resolves these open items from `hosted-oidc-design.md` §12

- **§12 item 4 (reachability):** Option A is shipped (pre-flight check); this doc
  is the Option B follow-up build plan it points to.
- **§12 item 3 (`X-Forwarded-Host`/`Proto`) — VERIFIED 2026-06-24:** ABS builds
  its redirect_uri from the `Host` header (`OidcAuthStrategy.js:292-293`, then
  `:327`). For hs.direct the public host is the synthesized name, so the HS
  container **must** forward `Host`/`X-Forwarded-Host`/`X-Forwarded-Proto` set to
  the **stable** hs.direct hostname so ABS's redirect_uri equals the value pinned
  on the Clerk client (§2.4). **Finding:** `HearthShelf/nginx/abs_proxy.conf`
  currently sets `Host $host` (line 6) and `X-Forwarded-Host $host` (line 9) — both
  to the **raw inbound `Host`**, *not* `PUBLIC_URL`'s host. For a fixed
  bring-your-own-domain server these happen to be equal, so Option A is unaffected;
  for hs.direct they diverge (inbound = IP-bearing label, pinned = stable host) and
  the mismatch **will** fail the callback. **Action (required before issuing OIDC
  clients for hs.direct servers):** for hs.direct mode, override these headers to
  the canonical `PUBLIC_URL` host (the stable `<hash>.<zone>`), not `$host`. This is
  the same change called for in §2.4 — do them together. Note `abs_proxy.conf` is
  shared by all ABS locations, so gate the override on hs.direct mode (env-driven)
  to avoid changing Option A behavior.

---

## 6. Out of scope here

- **Relay fallback (design §7 Option C)** for CGNAT servers with no inbound path
  — reintroduces a hop into the data path; separate decision, separate doc.
- IPv6 label encoding (add once the IPv4 POC is proven).
