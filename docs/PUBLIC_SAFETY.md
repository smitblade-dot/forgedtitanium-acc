# Public-safety review

The published frontend (`site/`) was derived from the private ACC-R011 application. The following were removed or neutralised:

| Removed | Why |
|---|---|
| Server panel, viewer-token field and every `/v1/*` call | The reporting backend is private and must not be reachable from the frontend |
| Agent report import, audit export, reconciliation tables | No imported data may appear in a public preview |
| Per-agent reporting integration details (branches, commits, workflow names, key and secret names) | Operational detail |
| Expenditure allowances, recorded approvals, approver names | Governance records, not public |
| Google Fonts requests | The page makes zero third-party requests |
| Routing and data exceptions, cost, model tier, run references, task names, approval details | Shown as Not published; the public status document cannot carry them |
| Internal hosting plan, deployment kit, signing client | Not part of the frontend |

Enforced by `tests/public_safety.test.js` (file allowlist, exactly one permitted request site, no storage APIs, no external URLs, forbidden-term scan,
credential-pattern scan of the whole repository, publish workflow gating) and by the zero-external-request check in `tests/visual/screenshots.mjs`.

## Data honesty
* Statuses: Unknown. Telemetry: Not connected. Activity, approvals, cost and health: No data.
* The five implementation stages are recorded evidence at the inspection date shown, never live status.
* Level 2 entries are Provisional unless corroborated by a cited record.
