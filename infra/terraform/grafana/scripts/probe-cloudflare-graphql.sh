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

# Errors panels plot ratio.status4xx / status5xx (0–1 share of count per bucket).
RATIO_BODY=$(CLOUDFLARE_ZONE_TAG="$CLOUDFLARE_ZONE_TAG" python3 - <<'PY'
import json, os
from datetime import datetime, timedelta, timezone
now = datetime.now(timezone.utc).replace(microsecond=0)
query = """query($zoneTag: String, $since: Time, $until: Time) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequestsAdaptiveGroups(
        limit: 6
        orderBy: [datetimeHour_DESC]
        filter: { datetime_geq: $since, datetime_leq: $until }
      ) {
        count
        ratio { status4xx status5xx }
        dimensions { datetimeHour }
      }
    }
  }
}"""
print(json.dumps({
  "query": query,
  "variables": {
    "zoneTag": os.environ["CLOUDFLARE_ZONE_TAG"],
    "since": (now - timedelta(hours=6)).isoformat().replace("+00:00", "Z"),
    "until": now.isoformat().replace("+00:00", "Z"),
  },
}))
PY
)

curl -sS "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$RATIO_BODY" | python3 -c '
import json, sys
j = json.load(sys.stdin)
if j.get("errors"):
    print("ERROR: ratio { status4xx status5xx } query failed:", json.dumps(j["errors"]), file=sys.stderr)
    sys.exit(1)
rows = j["data"]["viewer"]["zones"][0]["httpRequestsAdaptiveGroups"]
print("ratio sample (zone-wide, last 6h):")
for r in rows:
    t, ra = r["dimensions"]["datetimeHour"], r["ratio"]
    print("  %s  count=%d  4xx=%.4f  5xx=%.4f" % (t, r["count"], ra["status4xx"], ra["status5xx"]))
'
