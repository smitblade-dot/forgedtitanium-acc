# Secure communication: GitHub Actions to the reporting service

Status: designed and tested locally. Nothing is hosted or enabled.

## Path
```
GitHub Actions run (agent)  --HTTPS POST /v1/events, HMAC-signed-->  reporting service (private audit database)
                                                                          |
public ACC page  <--anonymous GET /public/status.json (redacted)---------+
```
The agent never talks to the public page, and the page never talks to anything but the redacted feed. The private audit database and
the private read endpoints are not on the public listener at all.

## Controls, and what each defends against
| Control | Defends against |
|---|---|
| HTTPS only; the reporter refuses plain http except to loopback, refuses `file:` and other schemes | Eavesdropping, downgrade |
| Per-agent key pair: key id (a repository variable) and secret (a repository secret, masked in logs). One key per agent code | One agent's key being used for another; a leaked key is revoked alone |
| Request signature: HMAC-SHA256 over method, path, timestamp, nonce and the SHA-256 of the body | Tampering, request forgery |
| 5 minute clock window and a single-use nonce per key | Replay of a captured request |
| `agent_id` in every event must equal the code its key is bound to | A compromised key writing another agent's status (tested) |
| Failed-authentication flood limit, per-key rate limit, 256 KB body cap | Abuse and audit flooding; each failure is audited, floods are summarised |
| Hash-chained, append-only audit log in the private database | Silent tampering with history |
| Reporter: one hard deadline per attempt, redirects refused, replies capped at 256 KB, exit code always 0 | A hostile or broken service holding or redirecting an agent run (tested against hang, drip, 5xx, garbage, 10 MB, redirects) |
| Outage buffer in the Actions cache, tagged with an HMAC made with the agent's secret, bounded to 200 events, 72 hours, 24 attempts, events carry run-based ids | Lost reports during an outage; duplicates; a poisoned cache (a buffer that fails the tag check is discarded) |
| Report steps skipped on pull requests; `continue-on-error`; 1 minute step timeout | A pull request from a fork reaching secrets; a reporting problem failing a job |
| Public feed built by an allowlist and re-validated before serving and again in the browser | Any task, cost, key, approval or audit detail reaching the public |

## Why there is no IP allow-list
GitHub-hosted runners use a very large, changing set of addresses, so an allow-list would either break reporting or be so wide as to
mean nothing. The signature, replay protection, per-agent binding and rate limits do the work instead.

## Secrets handling
* Keys are issued **on the service host** with `node server/acc_admin.js issue-agent-key <code>`; the secret is displayed once and only a derived form is stored there (`acc_keys.json`, mode 0600, never in Git).
* The owner places each secret straight into the Travel Intelligence repository's Actions secrets. It is never pasted into chat, commits, issues or the public ACC repository (the public repository's tests scan for credential shapes).
* The public ACC repository and page contain no key, secret, token or private address. The only service address in the page is the public feed URL.
* **Rotation:** issue a new key, update the repository secret and variable, run the agent once, confirm in the audit log, then `revoke <old key id>`.
* **Revocation or incident:** `revoke` the key (effective immediately); set `ACC_REPORTING_ENABLED` to anything other than `true` to silence all agents at their next run.

## Failure isolation (what happens when the service is down, slow or hostile)
The agent finishes and exits exactly as it would without reporting. The report step is a separate workflow step that never fails the job.
Events wait in the buffer and are sent on the next run with their original times. The public page keeps showing the last known
reports, says so after 15 minutes without a refresh, and reverts an agent to Unknown after 24 hours without a report.
