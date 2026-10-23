# ACC-R015: hosting comparison and recommendation

Nothing has been purchased, deployed or exposed. All prices below were read from the providers' own pages on **23 October 2026**
and converted at the **ECB reference rate of that day, EUR 1 = USD 1.1193**. Prices change; confirm at checkout.

## What the service needs
A small, always-on container running the tested Node service (at most about 200 events a day in total: the 15-minute monitor sends a start and an end event per run; a few KB per request), with:
a **persistent disk** (SQLite events, hash-chained audit log, keys), **HTTPS**, no operating system for the owner to maintain, and
no dependence on the owner's own hardware. Load is tiny: three agents report on schedules (every 15 minutes, hourly, daily) plus
anonymous reads of a cached 3 KB status document.

## Comparison
| Option | Plan | Monthly price (as listed) | Approx. EUR per month | Fits? |
|---|---|---|---|---|
| **Fly.io, EU region (recommended)** | shared-cpu-1x, 512 MB, 1 GB volume | 512 MB from $3.69 in the cheapest US regions; EU regions cost more (Frankfurt 1 GB is $7.73 against $6.70 in the US, about +15%); volume $0.15 per GB | **about EUR 3.95** (estimate: US price scaled by that ratio, EUR 3.81 compute + EUR 0.13 volume; exact EU price to be confirmed in Fly's calculator) | Runs the tested container unchanged, persistent volume, free TLS (first 10 certificates), shared IPv4 free, no OS to maintain |
| Fly.io, US region | same | $3.69 + $0.15 = $3.84 | EUR 3.43 | Same, lowest price; data held in the US |
| Fly.io, smallest | shared-cpu-1x, 256 MB, 1 GB volume | $2.19 + $0.15 = $2.34 | EUR 2.09 | Works on paper, but little headroom for Node plus SQLite; not recommended |
| Render | Hobby workspace ($0) + web service "less than 1 CPU, 512 MB" + 1 GB disk | $7 + $0.25 = $7.25 | EUR 6.48 | Fits and simple, but about twice Fly's price. The **free** plan does not fit: it spins down after 15 minutes idle, has an ephemeral filesystem, and cannot attach a persistent disk, so the audit log and keys would be lost |
| Hetzner Cloud | 1 vCPU shared server | EUR 5.99 to 6.49 excl. VAT (the page shows both) | EUR 5.99 to 6.49 | Cheapest per unit of capacity and EU based, but a **raw server**: the owner (or I) must patch the OS, run Docker, add TLS, a firewall and backups. Not "small managed" |
| Cloudflare Workers | Free plan, or Paid from $5 | Free: 100,000 requests a day; Paid minimum $5 | EUR 0 (Free) or EUR 4.47 (Paid) | **Requires a rewrite**: the server uses Node's built-in SQLite; it would have to be ported to D1 or Durable Objects and its audit and replay logic re-verified. Not a deployment of the existing code, so not recommended for now |

Sources: hetzner.com/cloud, docs.fly.io/about/pricing, render.com/pricing and render.com/docs/free,
developers.cloudflare.com/workers/platform/pricing, ECB euro reference rates (23 Oct 2026).
VAT: the Fly.io, Render and Cloudflare figures carry no VAT line; treatment depends on the company's VAT registration. Hetzner states excl. VAT.

## Recommendation
**Fly.io, one `shared-cpu-1x` 512 MB machine in Frankfurt with a 1 GB volume.**
* **Estimated recurring cost: about EUR 3.95 per month (about EUR 47 per year)**, plus well under EUR 0.10 for outbound data at this traffic. A US region would be about EUR 3.45.
* **Suggested approval ceiling: EUR 5 per month.** There is no free tier and no monthly platform fee; a card is required.
* Why: it runs the code and tests we already have, keeps the SQLite audit chain on a persistent volume, terminates HTTPS, and needs no OS administration. A single machine is a single point of failure, which is acceptable because agents keep their reports in a bounded outbox (200 events, 72 hours) and resend on the next run, and daily volume snapshots are on by default with 5 days retention.
* Prepared: `service/deploy/fly.toml`, `Dockerfile`, `entrypoint.sh`. The container image has **not been built or run** (no container runtime was available in the development sandbox); `fly config validate` and a first deploy are the first steps after approval.
* Fallback if the owner prefers a simpler dashboard: Render Starter at about EUR 6.50 per month.

## What I need approved, and what happens after
Nothing below has been done.
1. **Approval to purchase** Fly.io hosting up to EUR 5 per month (the owner creates the account and card; card details are never shared with anyone else).
2. **Approval to expose** the service: three public paths only (`POST /v1/events` signed, `GET /v1/health`, `GET /public/status.json` redacted and rate limited).
3. Then: deploy, issue one key for the **first agent**, set that agent's key variable and secret, point the frontend at the status address (a reviewed one-line change), merge PR #44 and set `ACC_REPORTING_ENABLED` (each separately approved).

## Update (ACC-R016)
The owner approved Fly.io, Frankfurt, up to EUR 5 a month. The Frankfurt 512 MB price could not be confirmed without an account, so activation is gated on a price read from Fly's calculator (see DEPLOY_FLY.md).
