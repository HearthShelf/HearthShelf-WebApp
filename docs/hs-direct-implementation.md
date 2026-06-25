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
| **DNS** | Map an hs.direct hostname to the server's IP | cheap | see §1.1 (depends on approach) |
| **Cert** | Give each server a wildcard cert for `*.<hash>.<zone>` | the real work | per-server key + renewal |

> **DNS approach — DECIDED 2026-06-24, REVISED same day (Option A active).**
> First decided B (CF API records) to avoid operating a DNS server. Then a small
> VPS (RackNerd, $21/yr — 1 vCPU / 1 GB / 20 GB / dedicated IPv4) was purchased to
> host the ACME engine (§1.2), which **removes the only reason B was chosen**: we
> now operate a box regardless. With the box a given, **Option A (stateless
> synthesis responder)** is both easier and more efficient: the IP is encoded in
> the hostname, so **dynamic IPs solve themselves** (a changed IP is just a
> different hostname that already resolves) — deleting B's per-server A-record
> lifecycle and IP-refresh loop entirely. The responder is ~100 lines, stateless,
> and co-locates with `acme.sh` on the VPS we already bought. Cloudflare stays
> **free**, used only for the DNS-01 challenge TXT (no per-server records). **We are
> building Option A. Option B is the shelved alternative** (revive if we ever want
> to retire the VPS and go fully serverless). §1.1 documents both; cert, pairing,
> and OIDC flow are identical either way.

### 1.1 DNS half

#### Option A — stateless wildcard synthesis on the VPS (ACTIVE)

A hostname encodes the target IP in its left label, hyphen-separated:

```
192-168-1-7.<server-hash>.<zone>      ->  A 192.168.1.7
203-0-113-9.<server-hash>.<zone>      ->  A 203.0.113.9
```

The responder parses the first label, validates it is four 0-255 octets, and
**synthesizes** the A answer. No per-server, per-IP, or per-user record is ever
written — any IP resolves instantly with zero provisioning.

- **Runtime:** the **RackNerd VPS** runs a small authoritative responder on UDP/53
  (a ~100-line custom responder; see `dns-direct/` build target). It is the
  authoritative nameserver for `<zone>`, delegated via `NS` records (POC:
  `d.hearthshelf.com` delegated to the VPS IP). It holds **no state** and does **no
  I/O** beyond parsing — trivially cache-friendly (long TTL on the synthesized
  answer).
- **Dynamic IPs solve themselves.** Because the IP lives in the hostname, a server
  whose IP changes simply computes a new hostname `<new-ip-label>.<hash>.<zone>`
  that *already* resolves correctly. **No record to update, no refresh loop, no
  stale window.** This is the decisive efficiency win over Option B.
- **CF stays free, DNS-01 only.** Cloudflare is touched *only* to write the
  `_acme-challenge` TXT for the wildcard cert (§1.2). No per-server records.
- **Hardening (UDP/53):** answer **only** for our `<zone>`, refuse recursion, drop
  ANY queries, rate-limit per source IP — standard authoritative-server hardening
  to avoid being a DNS-amplification reflector. Documented in the VPS setup.

IPv6 variant (optional, later): encode with a reversible scheme in the label and
synthesize a AAAA. One more answer in the same responder.

**DNS-rebinding caveat (must mitigate downstream):** a synthesized name can resolve
to a **private IP** (that's the feature — LAN reachability). Mitigations live at the
consumers, not the DNS layer: the control plane's `probeServer` runs from the
Worker (public egress, can't reach private space), and any server-side fetch of a
synthesized host must refuse private-range answers (§5, build step 5).

**redirect_uri note:** with synthesis the host `<ip-label>.<hash>.<zone>` changes
as the IP changes. The cert is a *wildcard* (`*.<hash>.<zone>`) so it keeps
validating, but the OIDC redirect must be pinned to the **stable** `<hash>.<zone>`
host and nginx must force ABS to *see* that host — see §2.4. This is why the §2.4
nginx `Host` override is load-bearing under Option A specifically.

**Zone delegation (POC):** `d.hearthshelf.com` is delegated to the VPS via `NS`
records in the `hearthshelf.com` zone. Server hostnames become
`<ip-label>.<hash>.d.hearthshelf.com`; production swaps to `…hearthshelf.app` (§3).

#### Option B — per-server A record via the Cloudflare DNS API (SHELVED)

> Retained as the serverless alternative. Revive if we ever retire the VPS and
> want the DNS half fully managed by Cloudflare. Not being built now.

Cloudflare is authoritative for `<zone>`; the control-plane Worker upserts one
record `<hash>.<zone> -> A <server-ip>` (proxied OFF) at pairing and **rewrites it
on every IP change** (the server must re-announce — a heartbeat + stale window this
design has to carry). No VPS or UDP/53, at the cost of per-server record lifecycle
code in the control plane. Chosen first, then superseded by A once the VPS made the
"don't run a server" argument moot.

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
- **Challenge-alias (REQUIRED under Option A - verified 2026-06-24):** because
  `<zone>` is delegated to the synthesis responder, the responder (not Cloudflare)
  is authoritative for `_acme-challenge.<hash>.<zone>`, and it only synthesizes A
  records - so a TXT written to Cloudflare there is **unreachable** and validation
  fails. Fix: the responder **CNAMEs** every `_acme-challenge.*.<zone>` to a name
  Cloudflare still serves (`_acme-challenge.hearthshelf.com`), and the broker runs
  `acme.sh --challenge-alias hearthshelf.com` so it writes the TXT there and Let's
  Encrypt follows the CNAME. This keeps the responder stateless. Without it, no
  wildcard issues. (This is the standard delegated-zone ACME pattern.)
- **Who runs ACME — DECIDED 2026-06-24: a broker service on the VPS.** The `<zone>`
  is ours, and a full ACME flow (order → DNS-01 → poll → finalize → download) is a
  durable, multi-minute state machine that a free Cloudflare Worker cannot host
  (Workflows/Durable-Objects would, but cost / complexity). The VPS we run for the
  DNS responder (§1.1) **also runs the ACME engine** (`acme.sh`), which is the
  standard, free, battle-tested way to do this on a normal box. CF is touched only
  via an API token for the DNS-01 TXT.
- **Key custody (CSR-broker, key never leaves the HS box):**
  1. The **HS container generates its own keypair + CSR** at claim time. The
     private key never leaves the box.
  2. The HS box sends the **CSR** (public key only) to the VPS broker, authorized
     by the control plane (the broker trusts a CP-issued, short-lived token so only
     paired servers can request certs).
  3. The **VPS broker** runs `acme.sh` for `*.<hash>.<zone>`, satisfies DNS-01 via
     the CF API token, finalizes against the CSR, and returns the **signed cert
     chain** (no key) to the HS box.
  4. The HS box installs `key (local) + cert (from broker)` and nginx serves it.
  Neither the control plane **nor** the VPS ever holds the private key — they only
  ever see the CSR and the resulting certificate.
- **Control-plane role:** broker authorizer + metadata only. It issues the
  short-lived token that lets an HS box call the VPS broker, and records cert
  status/expiry per server. It does **not** run ACME and does **not** touch the
  private key. (New: `control-plane/src/lib/certBroker.ts` for token issuance +
  status; no `cfDns.ts` A-record module is needed under Option A.)
- **Renewal:** wildcard certs are ~90-day; the VPS broker renews at ~60 days
  (`acme.sh` cron), re-running DNS-01 against the same CF token and re-signing the
  box's existing CSR/key. Fully automated on the VPS; the HS box just pulls the
  refreshed cert.

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

   **Note under Option B (active DNS approach):** the hs.direct hostname is the
   stable `<hash>.<zone>` and only the A record's *value* changes on IP change, so
   the browser normally connects to the stable host and ABS's inbound `Host` is
   already stable — the redirect_uri is correct without the override in the common
   case. Keep the nginx `Host` override anyway: it is cheap, it makes the redirect
   deterministic regardless of how the browser reached the box (e.g. a stale cached
   IP-bearing name, a future Option-A revival, or a direct-IP hairpin), and it
   costs nothing for Option A bring-your-own-domain servers since it is gated on
   hs.direct mode.

---

## 3. POC → production

Per design §7 (locked):

- **POC:** zone `d.hearthshelf.com`, certs `*.<hash>.d.hearthshelf.com`. Zero new
  spend, proves CF-DNS record write + DNS-01 + nginx cert loading end-to-end.
- **Production:** dedicated **`.app`** domain (lean `hearthshelf.app`) registered
  via **Cloudflare**, for Public-Suffix-List isolation from `hearthshelf.com` /
  `clerk.hearthshelf.com` (the rebinding-prone hs.direct names and any cookies sit
  on a different registrable domain) and `.app`'s HSTS-preload. ~$14/yr.
- **The swap is a config change:** the `<zone>` env (CF zone id + base domain) and
  the cert base. The per-server pairing/issuance flow is identical. No code fork.

---

## 4. Build order

> Reachability "Option A/B/C" in `hosted-oidc-design.md` §7 (BYO-domain vs
> hs.direct vs relay) are a *different* axis from the DNS "Option A/B" in §1.1
> (synthesis vs CF-records). This build = reachability-**hs.direct** using
> DNS-**synthesis**. "Option A" below means the DNS one (synthesis) unless noted.

0. **Prereq:** the bring-your-own-domain auth path proven end-to-end (design §13
   steps 1-3) — reachability pre-flight check is already shipped.
1. **VPS base** (`dns-direct/` + `cert-broker/` repos/dirs): provision the RackNerd
   box; delegate `d.hearthshelf.com` to it via `NS`. Stand up the **synthesis DNS
   responder** on UDP/53 (hardened: own-zone-only, no recursion, rate-limited).
   Verify `dig 192-168-1-7.<hash>.d.hearthshelf.com @<vps-ip>` returns
   `192.168.1.7`.
2. **VPS cert broker** (`acme.sh` + a thin HTTP service): accepts a CSR + a
   CP-issued token, runs DNS-01 for `*.<hash>.d.hearthshelf.com` via the CF API
   token, returns the signed chain. Build against **Let's Encrypt staging**. Verify
   a staging wildcard issues for a throwaway hash from a throwaway CSR.
3. **Control-plane broker authorizer** (`control-plane/src/lib/certBroker.ts` +
   route): issue the short-lived token that lets a paired HS box call the VPS
   broker; record cert status/expiry per server (new D1 table `server_certs`). No
   ACME, no private key, no A-records.
4. **HS container cert custody + nginx serving:** the HS/AIO box generates its own
   keypair + CSR, calls the CP for a broker token, calls the VPS broker, installs
   `key(local)+cert`, and nginx serves HTTPS on it. Verify
   `curl https://<ip-label>.<hash>.d.hearthshelf.com/healthcheck` resolves (synthesis)
   and serves the (staging) wildcard.
5. **Pairing integration:** compute the hostname `<ip-label>.<hash>.<zone>` →
   `PUBLIC_URL`; pin the per-server Clerk redirect to the **stable** `<hash>.<zone>`
   host (§2.4); **and** override `Host`/`X-Forwarded-Host` in nginx to that stable
   host for hs.direct mode (§5 / §12.3 — verified required: ABS builds redirect_uri
   from the inbound Host). Run the existing reachability check.
6. **Renewal automation** (VPS `acme.sh` cron, ~60-day) + **private-IP refusal** on
   any server-side fetch of a synthesized host (§1.1 caveat). Dynamic IPs need **no**
   work — the hostname encoding handles them.
7. **Production swap** to `hearthshelf.app` (config-only: delegate the new zone to
   the VPS responder + point the broker's cert base + CF token at it).

---

## 5. Resolves these open items from `hosted-oidc-design.md` §12

- **§12 item 4 (reachability):** the MVP (reachability Option A, BYO-domain
  pre-flight check) is shipped; this doc is the reachability-Option-B (hs.direct)
  follow-up build plan it points to.
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

- **Option A synthesis DNS responder** — shelved (§1.1); the ideal design, not
  being built. Revisit only if CF per-record limits / dynamic-IP churn / exact
  Plex parity ever justify operating DNS infrastructure on a VPS.
- **Relay fallback (design §7 Option C)** for CGNAT servers with no inbound path
  — reintroduces a hop into the data path; separate decision, separate doc.
- IPv6 (add an AAAA record alongside the A once the IPv4 path is proven; trivial
  under Option B — one more record write).
