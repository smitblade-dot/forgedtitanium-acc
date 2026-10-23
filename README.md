# FORGEDTITANIUM Agent Command Centre (public-safe frontend)

A static, interactive browser application: the approved futuristic SVG orbital (00 FORGEDTITANIUM and streams 01 to 06),
clickable Level 2 sub-streams, individual agents and five-section agent detail panels.

**It runs entirely in the browser from static files in `site/`. It has no backend and holds no credentials.** Its only network
request is one anonymous GET of a restricted status document (`status.json`, see [docs/LIVE_STATUS.md](docs/LIVE_STATUS.md)).
Every status reads Unknown and every connection reads Not connected until genuine agent reports are available. No
operational figure is invented.

| | |
|---|---|
| Status | Built and tested. **Not published.** Reporting is disabled. |
| Source of truth | `site/` (what is published) |
| Tests | `npm ci && npm test` (77 automated tests), `npm run test:visual` (14 browser checks and screenshots) |
| Local preview | `npm run serve` then open the printed address |
| Publishing | Manual, approval-gated: see [docs/PUBLISHING.md](docs/PUBLISHING.md) |

## What is in the register
* 6 streams, 31 Level 2 entries (1 corroborated, 30 provisional).
* 8 agents: 3 verified Travel Intelligence agents (with their issued codes) and 5 provisional agents, clearly labelled. Provisional agents carry no code.
* Five implementation stages per agent are recorded text, taken from evidence at inspection time (23 Oct 2026). They are not live readings.

## What is deliberately not here
The authenticated reporting backend, agent keys, viewer tokens, signing code, hosting details, expenditure allowances,
approval records, repository branch names and internal reconciliation notes. See [docs/PUBLIC_SAFETY.md](docs/PUBLIC_SAFETY.md).
