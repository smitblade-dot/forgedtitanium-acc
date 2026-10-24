# ACC-R018: proposed public cost projection (for owner review)

**Status: prepared, tested, not enabled, not deployed.** `GET /public/cost.json` exists only behind `ACC_PUBLIC_COST=1`, which is off. Nothing about
spend is public today. The page shows **No cost data**. Enabling it needs the owner's approval of the fields below, then a redeploy of the service.

## Where the figures come from
Only cost figures that an agent itself reported inside an authenticated, validated execution record (`cost_eur` with its `cost_basis`, or
`cost_usd_estimated`). The projection never estimates spend from activity counts, never turns a missing figure into zero, and never adds
subscription usage to API cost. The document states its evidence: **agent execution records, not provider invoices** (`provider_confirmed: false`).
A provider-confirmed source (Anthropic usage export or invoice) does not exist in the ACC today; adding one is a separate decision.

## Proposed public fields (schema `acc-public-cost/1`)
| Field | Meaning | Rule |
|---|---|---|
| `schema`, `generated_at_utc`, `currency` (`EUR`), `time_zone` (`Europe/Nicosia`) | header | fixed values |
| `evidence.kind`, `provider_confirmed`, `note`, `subscription_note` | what the figures are | fixed text; `provider_confirmed` is `false` |
| `today.date`, `month.month` | the Cyprus calendar day and month | Europe/Nicosia, not UTC |
| `*.api.state` | `recorded` or `no_cost_data` | `recorded` only if at least one report carried an API cost |
| `*.api.amount_eur` | sum of reported API cost in EUR | `null` when `no_cost_data`; `0` only when reports explicitly state 0 |
| `*.api.costed_reports`, `*.api.completion_reports` | coverage | how many completion reports carried a cost, of how many completions |
| `*.subscription.state`, `.amount_eur`, `.costed_reports` | subscription usage, kept separate | never added to API |
| `*.original_currency.*` | USD estimates exactly as reported | `converted` is always `false`; no EUR conversion is made |
| `by_agent[]` | the same figures per verified agent | agent code and public name only |
| `by_model_tier[]` | per reported tier: `code` (no model call), `haiku`, `sonnet`, `opus` | tier as reported; exact model identifiers are not published |

## Never included
Spending allowances and limits, approval references and requests, task names, run references, event ids, key ids, flags, error text, model
identifiers beyond the tier, provisional agents. A strict allowlist check (`assertPublicCostSafe`) runs before anything is served or written.

## Decisions for the owner
1. Approve or amend the field list above.
2. Whether a recorded `0.00` (reports that state no model call) may be shown publicly. Today every cost report is exactly that: 13 of 13 completions, tier `code`.
3. Whether `by_agent` and `by_model_tier` may be public, or only the totals.
4. Whether a provider-confirmed source should be added later so figures are no longer agent-reported.
5. Approval to redeploy the service with `ACC_PUBLIC_COST=1` and to point the page at the new document (a second approved public address).

## Review without publishing
`node server/acc_admin.js publish-cost <file.json>` writes the projection to a file for review. It does not serve anything.
