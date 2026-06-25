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

> **DNS approach — DECIDED 2026-06-24 (Option B active, Option A shelved).**
> The DNS half has two viable shapes. **Option A** (stateless synthesis responder)
> is the *ideal* design — true Plex parity, zero records, any IP resolves
> instantly — but it makes us operate an authoritative DNS server (a VPS, UDP/53
> attack surface, ideally two boxes for redundancy, and a hard dependency every
> server's HTTPS rides on). **Option B** (per-server A record via the Cloudflare
> DNS API) deletes all of that: Cloudflare stays authoritative, the control-plane
> Worker writes one A record per server at pairing — which it must touch the CF
> API for *anyway* to run the DNS-01 cert challenge — so there's no new server to
> run, no UDP surface, no VPS cost, and CF's anycast reliability instead of a $5
> box. **We are building Option B now and shelving Option A.** §1.1 documents both;
> the rest of this doc (cert, pairing, build order) is identical either way.

### 1.1 DNS half

#### Option B — per-server A record via the Cloudflare DNS API (ACTIVE)

Cloudflare is authoritative for `<zone>`. At pairing (and whenever the server's
IP changes), the control-plane Worker calls the **Cloudflare DNS API** to upsert a
single record:

```
<hash>.<zone>                         ->  A <server-current-ip>
```

Note the host is the **stable** `<hash>.<zone>` (no IP label) — this is the same
canonical host the cert wildcard covers and the Clerk redirect pins (§2.4), so the
hostname never changes as the IP changes; only the A record's *value* is rewritten.
A dynamic-IP server refreshes its A record by re-announcing its IP to the control
plane (the same channel it uses to keep the cert valid).

- **State:** one A record per server in the CF zone (proxied = OFF / "DNS only",
  so the real origin IP is returned and TLS terminates on the server, not CF).
- **Who writes it:** the control plane, via `control-plane/src/lib/cfDns.ts`
  (new) — the same module that writes the `_acme-challenge` TXT for DNS-01 (§1.2).
- **Runtime we operate:** none. No VPS, no UDP/53, no synthesis service.
- **Tradeoff vs. A:** we provision one record per server (not "zero records"), and
  a dynamic-IP server must re-announce on IP change. In return: zero DNS ops, no
  attack surface, CF anycast.

**DNS-rebinding caveat still applies:** the A record can point at a private IP
(that's the LAN-reachability feature). Mitigations live at the consumers exactly
as in Option A — `probeServer` runs from the Worker (public egress), and any
server-side fetch of an hs.direct host must refuse private-range answers (§5,
build step 5). The CF record being proxied-OFF does not change this.

**Zone delegation (POC):** the zone is `d.hearthshelf.com`, delegated to
Cloudflare (or a CF-managed subdomain zone). Server hostnames become
`<hash>.d.hearthshelf.com`; production swaps to `<hash>.hearthshelf.app` (§3).

#### Option A — stateless wildcard synthesis (SHELVED, the ideal)

> Retained as the north-star design. Revisit if per-record CF API limits, dynamic-
> IP churn, or a desire for exact Plex "zero-provisioning" parity ever justify
> operating DNS infrastructure. Not being built now.

A hostname encodes the target IP in its left label, hyphen-separated:

```
192-168-1-7.<server-hash>.<zone>      ->  A 192.168.1.7
203-0-113-9.<server-hash>.<zone>      ->  A 203.0.113.9
```

The responder parses the first label, validates it is four 0-255 octets, and
**synthesizes** the A answer. No per-server, per-IP, or per-user record is ever
written — any IP resolves instantly with zero provisioning.

IPv6 variant (optional, later): encode with a reversible scheme in the label and
synthesize a AAAA.

**Runtime:** a Cloudflare Worker **cannot** serve raw DNS (UDP/53). Option A needs
an always-on authoritative DNS service we run (a small VPS running a ~100-line
custom UDP responder, or CoreDNS with a synthesis plugin). It holds **no state**
and does **no I/O** beyond parsing — trivially scalable, cache-friendly — but it is
a server *we operate*, with the ops burden the banner above describes.

With synthesis, the IP lives in the hostname's left label, so the host
`<ip-label>.<hash>.<zone>` changes as the IP changes — which is exactly the source
of the §2.4 redirect_uri subtlety. Option B sidesteps that at the DNS layer (stable
host, value-only updates), but §2.4's nginx `Host` override is still required
because the browser may reach the server by IP-bearing names in other paths; keep
the §2.4 fix regardless of DNS approach.

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

0. **Prereq:** Option A auth path proven end-to-end (design §13 steps 1-3) —
   reachability check is already shipped.
1. **CF DNS module** (`control-plane/src/lib/cfDns.ts`): upsert/delete an A record
   `<hash>.<zone> -> <ip>` (proxied OFF) and the `_acme-challenge` TXT, via the
   Cloudflare DNS API. Pure unit-testable wrapper; one module serves both the A
   record (DNS half) and the DNS-01 TXT (cert half). Verify against a CF test zone.
2. **DNS-01 broker** in the control plane: per-server ACME order + TXT write
   (via cfDns) against our zone; issue a wildcard for `*.<hash>.d.hearthshelf.com`.
   Build against **Let's Encrypt staging**. Verify a (staging) cert issues for a
   throwaway hash.
3. **Server cert custody + nginx serving:** the HS/AIO container generates its
   key, obtains the cert (via the broker), and nginx serves HTTPS on it. Verify
   `curl https://<hash>.d.hearthshelf.com/healthcheck` resolves (CF A record) and
   serves the wildcard cert.
4. **Pairing integration:** compute the stable hostname `<hash>.<zone>` →
   `PUBLIC_URL`; write the A record (cfDns); pin the per-server Clerk redirect to
   that host (§2.4); **and** override `Host`/`X-Forwarded-Host` in nginx to that
   stable host for hs.direct mode (§5 / §12.3 — verified required: ABS builds
   redirect_uri from the inbound Host). Run the existing reachability check.
5. **Renewal automation** (~60-day) + **dynamic-IP A-record refresh** (server
   re-announces IP → cfDns rewrites the A value) + **private-IP refusal** on any
   server-side fetch of an hs.direct host (§1.1 caveat).
6. **Production swap** to `hearthshelf.app` (config-only: CF zone id + base
   domain + cert base).
7. **(Shelved) Option A** synthesis responder — only if §1.1's revisit triggers
   fire. Not part of this build.

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

- **Option A synthesis DNS responder** — shelved (§1.1); the ideal design, not
  being built. Revisit only if CF per-record limits / dynamic-IP churn / exact
  Plex parity ever justify operating DNS infrastructure on a VPS.
- **Relay fallback (design §7 Option C)** for CGNAT servers with no inbound path
  — reintroduces a hop into the data path; separate decision, separate doc.
- IPv6 (add an AAAA record alongside the A once the IPv4 path is proven; trivial
  under Option B — one more record write).
