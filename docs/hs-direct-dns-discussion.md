# hs.direct DNS half — discussion primer

> Standalone briefing for a sidebar conversation. Self-contained: you can paste
> this into a fresh chat and discuss without other context. The decision below is
> **already made** (build Option B, shelve Option A) — this exists to pressure-test
> that decision and think about edge cases, not to re-litigate from zero.

## The problem in one paragraph

HearthShelf lets a user on `app.hearthshelf.com` (hosted) browse and play their
library on a **self-hosted** server. The browser connects **directly** to that
server's origin over HTTPS. For that to work the server needs a public hostname
with a **CA-valid TLS cert**. Most self-hosters don't have one (they're on a LAN
IP, a dynamic IP, or behind CGNAT). "hs.direct" is the feature that hands every
server a working HTTPS hostname automatically — the same gap Plex closes with
`*.plex.direct`. It splits into a **DNS half** (map a hostname to the server's IP)
and a **cert half** (give the server a wildcard TLS cert). This primer is about the
**DNS half only**; the cert half (per-server Let's Encrypt wildcard via DNS-01,
server holds its own key) is settled and unaffected.

## The two ways to do the DNS half

### Option A — stateless synthesis nameserver (the "ideal", SHELVED)

Encode the IP in the hostname: `192-168-1-7.<hash>.<zone>` resolves to
`192.168.1.7`. A custom authoritative nameserver parses the left label and
**synthesizes** the answer on the fly. **Zero records are ever written** — any IP
resolves instantly, no per-server provisioning. This is exactly what Plex does.

- **Upside:** purest design. Any IP (LAN, WAN, dynamic) just works, no state, no
  per-server API calls, infinite scale, exact Plex parity.
- **Downside:** a Cloudflare Worker **cannot** serve raw DNS (UDP/53), so we'd have
  to **operate an authoritative nameserver ourselves** — a small VPS running a
  ~100-line UDP responder (or CoreDNS + a synthesis plugin). That means: a public
  UDP/53 service (DNS-amplification attack surface to harden), patching and
  monitoring, and **ideally two boxes** because if it goes down, *every* hs.direct
  server's HTTPS stops resolving at once. Real, ongoing ops for a hobby-scale
  project. ~$5/mo per box (we looked at IONOS, GoDaddy, Hetzner).

### Option B — per-server A record via the Cloudflare DNS API (ACTIVE, building now)

Cloudflare is already authoritative for our zone. At pairing, the control-plane
Worker calls the **CF DNS API** to write one record:
`<hash>.<zone> -> A <server-ip>` (DNS-only, not proxied, so TLS terminates on the
server). On IP change, the server re-announces and we rewrite the record's value.

- **Upside:** **we run no servers.** No VPS, no UDP/53, no attack surface, no
  redundancy problem — CF's global anycast DNS does it. And the control plane
  **already** calls the CF API to write the DNS-01 cert-challenge TXT, so writing
  one more A record at the same moment is nearly free. Zero new ops.
- **Downside:** we provision **one record per server** (not "zero records"), and a
  **dynamic-IP** server must re-announce its IP when it changes (a heartbeat the
  server already needs for cert renewal anyway). Subject to CF DNS API limits at
  very large scale (not a near-term concern).

## Why B was chosen

The entire *point* of A's elegance is "zero provisioning per IP." But our control
plane is **already** touching the CF API per-server for the cert challenge. So A's
big advantage mostly evaporates in our specific architecture, while its cost (being
a DNS operator) is 100% real. B trades a tiny bit of purity (one record/server +
dynamic-IP re-announce) for **deleting an entire piece of infrastructure**. For a
small team, not operating a nameserver is worth far more than zero-records purity.

A nice side effect: under B the hostname is the **stable** `<hash>.<zone>` (no IP
in the name) and only the record's *value* changes. That sidesteps a thorny
auth-flow subtlety (the OIDC `redirect_uri` would otherwise churn every time the IP
label changed).

## Questions worth chewing on in the sidebar

1. **Dynamic-IP re-announce cadence.** How often do home IPs actually change, and
   what's the right heartbeat interval / TTL so a changed IP heals fast without
   hammering the CF API? What's the user-visible failure window during a change?
2. **CF API rate/scale limits.** At what server count do per-record writes or the
   CF API rate limits start to bite? Is there a batching or zone-sharding story if
   hs.direct ever gets popular? (This is the main thing that would *revive* Option A.)
3. **DNS-rebinding.** The A record can point at a **private IP** (that's the
   LAN-reachability feature, same as Plex). Mitigation is at the consumers: the
   control-plane probe runs from the Worker (public egress only), and any
   server-side fetch of an hs.direct host must refuse private-range answers. Are
   those two mitigations sufficient, or do we want more (e.g. a public-IP-only mode
   toggle)?
4. **TTL tradeoff.** Low TTL = fast IP-change healing but more resolver traffic and
   less caching; high TTL = stale-IP windows. What's the sweet spot?
5. **Failure mode comparison.** Under B, if CF DNS has an outage, every hs.direct
   server is unreachable — but so is half the internet, and we'd have no better
   story running our own box. Under A, *our* box is the single point of failure. Is
   "depend on CF" clearly the lower-risk dependency? (I think yes.)
6. **The revival trigger.** We've written down *when* to reconsider A (CF per-record
   limits, heavy dynamic-IP churn, or a hard need for exact Plex zero-provisioning
   parity). Are those the right triggers? Anything missing?
7. **IPv6.** Under B, IPv6 is just one more record (an AAAA) per server. Worth doing
   in the first pass or deferring?

## Status

- **Decision (REVISED 2026-06-24):** Build **Option A** (synthesis DNS on a VPS).
  A RackNerd VPS ($21/yr) was purchased to host the ACME engine, which removed the
  only reason B was chosen ("don't run a server"). With the box a given, A is
  easier and more efficient — dynamic IPs solve themselves. Option B is now the
  shelved serverless alternative.
- **Spec:** `docs/hs-direct-implementation.md` §1.1 (Option A active), §1.2 (VPS
  cert-broker custody), §4 (build order). Cert/pairing/OIDC unchanged.
- **The open questions above still stand** — they're about the synthesis approach
  (TTL, rebinding, hardening, IPv6) and are now the *active* design surface, not a
  hypothetical.
