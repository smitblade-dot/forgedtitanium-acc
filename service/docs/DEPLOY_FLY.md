# Deploying the ACC reporting service on Fly.io

**Status: prepared and tested offline; not deployed.** Nothing here has been created on Fly.io, exposed to the internet, or changed in
Travel Intelligence. Production agent reporting is off.

Scope: only `service/` is deployed. The public website (`site/`, GitHub Pages) is a separate deployment and is not touched.

## Plan and cost
Fly.io, Frankfurt (`fra`), **one** `shared-cpu-1x` 512 MB machine, **one** 1 GB persistent volume, HTTPS terminated by Fly.
Approved ceiling: **EUR 5.00 a month** = USD 5.5965 at the ECB rate of 23 Oct 2026 (EUR 1 = USD 1.1193).
Fly's published prices (docs.fly.io/about/pricing, read 23 Oct 2026): shared-cpu-1x 512 MB is USD 3.69 a month in the cheapest US regions, volumes
USD 0.15 per GB, shared IPv4, IPv6 and the first 10 certificates free, inbound data free, outbound in Europe USD 0.02 per GB. The Frankfurt 512 MB price
could not be read without an account (Fly's calculator is interactive); the estimate is about USD 4.41 (EUR 3.94). **So the activation script requires the
total shown by Fly's calculator and refuses to continue (exit 3, nothing created) if it exceeds the ceiling.**
In the calculator choose: shared, 1 core, 512 MB, region Frankfurt, volume 1 GB, 1 machine, bandwidth Small.

## Signing in to Fly.io (official process)
The Fly.io account exists. The deployment needs a Fly credential in whichever place the commands run:
* **Option A, from the Claude Code environment (hands-off):** in the session's cloud environment settings add the secret `FLY_API_TOKEN` and allow the hosts `fly.io`, `api.fly.io`, `registry.fly.io`, `*.fly.dev`, and the hosts that serve the Fly CLI download (the official installer is `https://fly.io/install.sh`; its release files come from GitHub), then start a new session. Create the token in the Fly dashboard (Tokens) or with `fly tokens create org` after `fly auth login`; use a short expiry. Never paste a token into chat.
* **Option B, from your own computer:** install the CLI from fly.io/docs/flyctl/install, run `fly auth login` (it opens the browser sign-in and stores the credential locally), then from the `service/` directory run `deploy/activate_fly.sh --price-usd <calculator total>` with `FLY_API_TOKEN` set from `fly auth token`.
Either way the credential stays out of GitHub source code, and out of `service/`.

## Steps once a credential is available (all scripted)
1. `service/deploy/activate_fly.sh --price-usd <calculator total>`: price guard, `fly.toml` must still match what was priced, `fly config validate`, create the app and the 1 GB volume in Frankfurt, deploy with `--ha=false`, scale to exactly one machine, wait for the health check, run the read-only live checks.
2. `service/deploy/provision_agent_keys.sh controller` (then `master`, `builder`): issues each agent's signing key **on the machine** and writes the key id and secret straight into the Travel Intelligence repository's Actions settings (secret on stdin only, never printed). It never enables reporting. Needs a fine-grained GitHub token limited to `smitblade-dot/Travel_Intelligence` (Actions secrets and variables: write), supplied as `GH_ADMIN_TOKEN` the same way as the Fly credential.
3. **Approval-gated, not done by any script:** merge Travel Intelligence PR #44; set `ACC_REPORTING_ENABLED=true`; publish the revised ACC frontend (pointing the page's `acc-status-url` at `https://forgedtitanium-acc-service.fly.dev/public/status.json`).
4. Verify: `SERVICE_URL=https://forgedtitanium-acc-service.fly.dev SITE_URL=https://smitblade-dot.github.io/forgedtitanium-acc/ EXPECT_AGENTS=<codes> node scripts/verify_live.mjs --expect-live --require-browser`.

Connect the Production Controller first (ordinary code, no model call, observe mode, hourly). Agents without a key skip reporting harmlessly, so the Master Agent (every 15 minutes, its Haiku monitor reports under it) and the Country Intelligence Builder (daily 05:41 UTC) follow one at a time.

## Public surface once hosted
`POST /v1/events` (per-agent HMAC signature, 5 minute window, single-use nonce), `GET /v1/health` (`{"ok":true}`), `GET /public/status.json` (allowlisted, rate limited, cached 30 s, CORS only for `https://smitblade-dot.github.io`). Every other path answers 404. The private database, audit log and all read endpoints are on a private port that is not published.

## Rollback
Set `ACC_REPORTING_ENABLED` to anything but `true` (agents stop reporting at their next run, unaffected); remove a single agent's two settings or `node server/acc_admin.js revoke <key id>`; `fly scale count 0` (agents buffer and resend later) or `fly apps destroy` after `node server/acc_admin.js backup /data/backups`.

## Not verified against real Fly.io
The `fly.toml` syntax (the script runs `fly config validate` first), the container build (no container runtime was available in the development sandbox), `fly ssh console` output handling, and the real health check. Each is exercised first by the script, which stops on failure.
