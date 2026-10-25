#!/usr/bin/env bash
# Verify Free-plan GraphQL analytics datasets for the DressMe zone.
# Requires: CLOUDFLARE_API_TOKEN (Zone Analytics Read), CLOUDFLARE_ZONE_TAG (zone id).
set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN (Zone Analytics Read)}"
: "${CLOUDFLARE_ZONE_TAG:?Set CLOUDFLARE_ZONE_TAG (Cloudflare zone id / zoneTag)}"

QUERY='query($zoneTag: String) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      settings {
        httpRequestsAdaptiveGroups {
          enabled
          maxDuration
          maxPageSize
          notOlderThan
        }
        firewallEventsAdaptive {
          enabled
          maxDuration
          maxPageSize
          notOlderThan
        }
        firewallEventsAdaptiveGroups {
          enabled
          maxDuration
          maxPageSize
          notOlderThan
        }
      }
    }
  }
}'

BODY=$(CLOUDFLARE_ZONE_TAG="$CLOUDFLARE_ZONE_TAG" QUERY="$QUERY" python3 - <<'PY'
import json, os
print(json.dumps({
  "query": os.environ["QUERY"],
  "variables": {"zoneTag": os.environ["CLOUDFLARE_ZONE_TAG"]},
}))
PY
)

RESP=$(curl -sS "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$BODY")

echo "$RESP" | python3 -m json.tool

# Free plan: firewallEventsAdaptiveGroups is typically disabled — warn loudly.
echo "$RESP" | python3 -c '
import json, sys
j = json.load(sys.stdin)
zones = ((j.get("data") or {}).get("viewer") or {}).get("zones") or []
if not zones:
    print("WARNING: no zones returned — check token zone scope and CLOUDFLARE_ZONE_TAG", file=sys.stderr)
    sys.exit(1)
groups = ((zones[0].get("settings") or {}).get("firewallEventsAdaptiveGroups")) or {}
if not groups.get("enabled"):
    print(
        "NOTE: firewallEventsAdaptiveGroups is disabled (expected on Cloudflare Free). "
        "Use httpRequestsAdaptiveGroups status 403/429 + firewallEventsAdaptive instead.",
        file=sys.stderr,
    )
'
