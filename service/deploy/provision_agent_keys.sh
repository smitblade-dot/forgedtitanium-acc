#!/usr/bin/env bash
# Issue per-agent signing keys ON the Fly machine and store them directly in the Travel Intelligence repository's Actions
# settings, so a secret is never displayed, logged or pasted anywhere. Does NOT enable reporting.
#
#   FLY_API_TOKEN=... GH_ADMIN_TOKEN=<fine-grained token: Actions secrets and variables write on Travel_Intelligence> \
#   service/deploy/provision_agent_keys.sh [--app NAME] [--repo OWNER/REPO] AGENT_KEY...
# AGENT_KEY is one of: master | builder | controller   (the Production Controller is recommended first)
#
# Reporting stays OFF until the owner separately sets ACC_REPORTING_ENABLED=true (see docs/DEPLOY_FLY.md).
set -euo pipefail
APP="forgedtitanium-acc-service"; REPO="smitblade-dot/Travel_Intelligence"; AGENTS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --app) APP="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    master|builder|controller) AGENTS+=("$1"); shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
die() { echo "$1" >&2; exit "${2:-1}"; }
[ -n "${FLY_API_TOKEN:-}" ] || die "FLY_API_TOKEN is not set." 2
[ -n "${GH_ADMIN_TOKEN:-}" ] || die "GH_ADMIN_TOKEN is not set (fine-grained token limited to $REPO, Actions secrets and variables: write)." 2
[ ${#AGENTS[@]} -gt 0 ] || die "Name at least one agent: master, builder or controller." 2
[ "$REPO" = "smitblade-dot/Travel_Intelligence" ] || die "Refusing to write settings to $REPO: only smitblade-dot/Travel_Intelligence is in scope." 2

code_of() { case "$1" in master) echo 03AA-04_Master_Agent_TI_Ops_Director ;; builder) echo 03AA-04_Country_Intelligence_Builder_TI ;; controller) echo 03AA-04_Production_Controller_TI ;; esac; }
suffix_of() { case "$1" in master) echo MASTER ;; builder) echo COUNTRY_BUILDER ;; controller) echo PRODUCTION_CONTROLLER ;; esac; }
export GH_TOKEN="$GH_ADMIN_TOKEN"

gh variable set ACC_REPORT_URL --repo "$REPO" --body "https://$APP.fly.dev" >/dev/null
for a in "${AGENTS[@]}"; do
  CODE="$(code_of "$a")"; SUF="$(suffix_of "$a")"
  JSON="$(fly ssh console --app "$APP" --command "runuser -u acc -- env ACC_DATA_DIR=/data node /app/server/acc_admin.js issue-agent-key $CODE" 2>/dev/null | sed -n '/^{/,/^}/p')"
  KEY_ID="$(printf '%s' "$JSON" | jq -r .key_id)"; SECRET="$(printf '%s' "$JSON" | jq -r .secret_b64url)"
  [ -n "$KEY_ID" ] && [ "$KEY_ID" != "null" ] && [ -n "$SECRET" ] && [ "$SECRET" != "null" ] || die "Key issue failed for $CODE; nothing was stored." 5
  gh variable set "ACC_KEY_ID_$SUF" --repo "$REPO" --body "$KEY_ID" >/dev/null
  printf '%s' "$SECRET" | gh secret set "ACC_AGENT_SECRET_$SUF" --repo "$REPO" >/dev/null
  unset JSON SECRET
  echo "Connected (settings stored, reporting still off): $CODE  key id $KEY_ID"
done
echo "ACC_REPORT_URL set to https://$APP.fly.dev. Reporting is OFF until ACC_REPORTING_ENABLED=true is set by the owner."
