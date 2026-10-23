# ACC reporting service

The backend of the FORGEDTITANIUM Agent Command Centre: authenticated agent event ingestion, SQLite storage, a hash-chained
audit log, outage recovery, and a **sanitised public status feed**. It is deployed separately from the public website (`site/`,
published on GitHub Pages); this directory is never part of that site.

* **No secrets in this repository.** Agent signing keys are issued on the running service and stored in the Travel Intelligence repository's Actions settings. Nothing here contains a key, token or private address.
* **Public status feed only.** `GET /public/status.json` is built from an allowlist (state, last report time, short history). Tasks, costs, run references, approvals and audit records are never in it.
* **Register.** `acc_register.js` is the public-safe agent register (identities, streams, implementation notes). Internal approvals, allowances and reconciliation notes are not kept in this repository.
* **Run the tests:** `cd service && npm ci && npm test`. **Deploy:** see `docs/DEPLOY_FLY.md` (Fly.io, Frankfurt, one 512 MB machine, 1 GB volume, ceiling EUR 5 a month).

Public surface when hosted: `POST /v1/events` (per-agent HMAC signature, replay protection), `GET /v1/health`, `GET /public/status.json`.
Everything else, including the private dashboard, reads and audit endpoints, is not published.
