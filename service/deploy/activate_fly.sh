#!/usr/bin/env bash
# Activate the ACC reporting service on Fly.io (ACC-R016). Guarded: it will not create anything chargeable unless the price
# read from Fly's own calculator is supplied and is within the approved ceiling, and it makes sure only ONE machine runs.
#
#   FLY_API_TOKEN=<deploy token> service/deploy/activate_fly.sh --price-usd <monthly total from fly.io/calculator>
#                                [--app forgedtitanium-acc-service] [--org <slug>]
#
# In the calculator choose: shared, 1 core, 512 MB, region Frankfurt (fra), volume 1 GB, 1 machine, bandwidth Small.
# Approved ceiling: EUR 5.00 a month. If the figure is higher, this script stops (exit 3) and the owner must approve first.
set -euo pipefail

CEILING_EUR="${ACC_CEILING_EUR:-5.00}"
EUR_USD="${ACC_EUR_USD:-1.1193}"          # ECB reference rate, 23 Oct 2026; override with a current rate
HERE="$(cd "$(dirname "$0")" && pwd)"
SERVICE_DIR="$(cd "$HERE/.." && pwd)"
TOML="${ACC_FLY_TOML:-$SERVICE_DIR/fly.toml}"
APP="forgedtitanium-acc-service"; ORG=""; PRICE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --price-usd) PRICE="${2:-}"; shift 2 ;;
    --app) APP="${2:-}"; shift 2 ;;
    --org) ORG="${2:-}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

die() { echo "$1" >&2; exit "${2:-1}"; }
[ -n "${FLY_API_TOKEN:-}" ] || die "FLY_API_TOKEN is not set (a deploy token, kept in the environment, never in Git or chat)." 2
[[ "$PRICE" =~ ^[0-9]+(\.[0-9]+)?$ ]] || die "Supply --price-usd with the monthly total from Fly's calculator for the configuration above." 2

CEIL_USD="$(awk -v e="$CEILING_EUR" -v r="$EUR_USD" 'BEGIN{printf "%.2f", e*r}')"
if awk -v p="$PRICE" -v e="$CEILING_EUR" -v r="$EUR_USD" 'BEGIN{exit !(p > e*r)}'; then   # exact comparison, no rounding
  die "STOP: confirmed price USD $PRICE per month exceeds the approved ceiling EUR $CEILING_EUR (USD $CEIL_USD at $EUR_USD). Nothing was created. The owner must approve the higher cost first." 3
fi
echo "Price check passed: USD $PRICE per month is within EUR $CEILING_EUR (USD $CEIL_USD)."

# The cost-relevant settings in fly.toml must be exactly the ones that were priced.
grep -q '^primary_region = "fra"' "$TOML"      || die "fly.toml region is not fra: the price check does not apply." 4
grep -q 'size = "shared-cpu-1x"' "$TOML"        || die "fly.toml machine size is not shared-cpu-1x." 4
grep -q 'memory = "512mb"' "$TOML"              || die "fly.toml memory is not 512mb." 4
grep -q 'initial_size = "1gb"' "$TOML"          || die "fly.toml volume is not 1gb." 4
[ "$(grep -c '^\[\[vm\]\]' "$TOML")" = "1" ]    || die "fly.toml must define exactly one machine size." 4
grep -q 'min_machines_running = 1' "$TOML"      || die "fly.toml must keep exactly one machine running." 4

ORG_ARGS=(); [ -z "$ORG" ] || ORG_ARGS=(--org "$ORG")
fly version >/dev/null
fly config validate --config "$TOML"
if ! fly apps list --json | grep -q "\"Name\": *\"$APP\""; then
  fly apps create "$APP" "${ORG_ARGS[@]}"
fi
if ! fly volumes list --app "$APP" --json | grep -q '"name": *"acc_data"'; then
  fly volumes create acc_data --app "$APP" --region fra --size 1 --yes
fi
# --ha=false: without it Fly creates a second machine, which doubles the compute cost.
(cd "$SERVICE_DIR" && fly deploy --app "$APP" --config "$TOML" --remote-only --ha=false --yes)
COUNT="$(fly machines list --app "$APP" --json | jq 'length')"
if [ "$COUNT" != "1" ]; then
  echo "Found $COUNT machines; scaling to 1 to stay within the approved cost."
  fly scale count 1 --app "$APP" --yes
fi

URL="https://$APP.fly.dev"
OK=0
for i in $(seq 1 24); do
  if [ "$(curl -fsS --max-time 5 "$URL/v1/health" 2>/dev/null || true)" = '{"ok":true}' ]; then OK=1; break; fi
  sleep 5
done
[ "$OK" = "1" ] || die "The service did not answer its health check at $URL within two minutes. Nothing else was changed." 5
echo "Service healthy at $URL"
if [ -z "${ACC_SKIP_VERIFY:-}" ]; then
  SERVICE_URL="$URL" SITE_URL="${SITE_URL:-https://smitblade-dot.github.io/forgedtitanium-acc/}" node "$SERVICE_DIR/scripts/verify_live.mjs"
fi
echo "Next: service/deploy/provision_agent_keys.sh (issues keys on the host and stores them in GitHub without displaying them)."
