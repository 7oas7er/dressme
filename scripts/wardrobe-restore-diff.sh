#!/usr/bin/env bash
# Compare a pre-loss inventory.json against live Dynamo/media (or another inventory).
# Emits JSON + optional Markdown suitable for docs/templates/unrecovered-data-report.md.
#
# Usage:
#   export AWS_PROFILE=7oas7er AWS_DEFAULT_REGION=eu-north-1
#   ./scripts/wardrobe-restore-diff.sh --env stg --inventory ./inventory.json
#   ./scripts/wardrobe-restore-diff.sh --env prod --inventory s3://prod-dressme-backup-bucket/weekly/2026-11-13/inventory.json
#   ./scripts/wardrobe-restore-diff.sh --env stg --inventory ./pre.json --against ./post.json
#   ./scripts/wardrobe-restore-diff.sh --env stg --inventory ./pre.json --markdown ./unrecovered.md
#
# Requires: aws CLI, jq, python3. See docs/runbook.md.

set -euo pipefail

ENV=""
INVENTORY=""
AGAINST=""
MARKDOWN=""
REGION="${AWS_DEFAULT_REGION:-eu-north-1}"
CHECK_OBJECTS=1

usage() {
  cat <<'EOF'
Usage: wardrobe-restore-diff.sh --env stg|prod --inventory PATH|s3://... [--against PATH|s3://...] [--markdown OUT.md] [--skip-object-check]

Default: rebuild a live inventory from Dynamo Scan (+ optional S3 HeadObject for ready photo keys)
and diff against --inventory (the pre-loss baseline).

With --against, compare two inventory files without hitting AWS (except downloading s3:// paths).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV="${2:-}"
      shift 2
      ;;
    --inventory)
      INVENTORY="${2:-}"
      shift 2
      ;;
    --against)
      AGAINST="${2:-}"
      shift 2
      ;;
    --markdown)
      MARKDOWN="${2:-}"
      shift 2
      ;;
    --skip-object-check)
      CHECK_OBJECTS=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$ENV" != "stg" && "$ENV" != "prod" ]]; then
  echo "--env stg|prod is required" >&2
  exit 2
fi
if [[ -z "$INVENTORY" ]]; then
  echo "--inventory is required" >&2
  exit 2
fi

for cmd in aws jq python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/dressme-restore-diff.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

fetch_inventory() {
  local src="$1"
  local dest="$2"
  if [[ "$src" == s3://* ]]; then
    aws s3 cp "$src" "$dest" --region "$REGION" --only-show-errors
  else
    cp "$src" "$dest"
  fi
}

BASELINE="$WORK/baseline.json"
fetch_inventory "$INVENTORY" "$BASELINE"

CURRENT="$WORK/current.json"
if [[ -n "$AGAINST" ]]; then
  fetch_inventory "$AGAINST" "$CURRENT"
else
  # Reuse backup script's Scan path by calling a minimal inline dump → inventory.
  TABLE="${ENV}-dressme-items-table"
  MEDIA_BUCKET="${ENV}-dressme-media-bucket"
  DUMP="$WORK/dynamodb.jsonl"
  : >"$DUMP"
  START_KEY=""
  while true; do
    if [[ -z "$START_KEY" ]]; then
      PAGE="$(aws dynamodb scan --table-name "$TABLE" --region "$REGION" --output json)"
    else
      PAGE="$(aws dynamodb scan --table-name "$TABLE" --region "$REGION" --exclusive-start-key "$START_KEY" --output json)"
    fi
    echo "$PAGE" | jq -c '.Items[]' >>"$DUMP"
    START_KEY="$(echo "$PAGE" | jq -c '.LastEvaluatedKey // empty')"
    if [[ -z "$START_KEY" || "$START_KEY" == "null" ]]; then
      break
    fi
  done

  python3 - "$DUMP" "$CURRENT" "$ENV" "$TABLE" "$MEDIA_BUCKET" "$(date -u +%Y-%m-%d)" <<'PY'
import json, sys, datetime
from pathlib import Path

dump_path, inv_path, env, table, media, date_utc = sys.argv[1:7]

def from_av(av):
    if not isinstance(av, dict) or len(av) != 1:
        return av
    t, v = next(iter(av.items()))
    if t == "S":
        return v
    if t == "N":
        return v
    if t == "BOOL":
        return bool(v)
    if t == "NULL":
        return None
    if t == "L":
        return [from_av(x) for x in v]
    if t == "M":
        return {k: from_av(x) for k, x in v.items()}
    if t == "SS":
        return list(v)
    if t == "NS":
        return list(v)
    return av

items_out = []
meta = False
ready_keys = []
all_keys = []
for line in Path(dump_path).read_text(encoding="utf-8").splitlines():
    if not line.strip():
        continue
    raw = json.loads(line)
    item = {k: from_av(v) for k, v in raw.items()}
    sk = item.get("sk") or ""
    if sk == "META#attrOptions":
        meta = True
        continue
    if not str(sk).startswith("ITEM#"):
        continue
    item_id = item.get("itemId") or str(sk)[5:]
    photos = item.get("photos") or []
    photo_keys, ready, thumbs = [], [], []
    for p in photos:
        if not isinstance(p, dict):
            continue
        key = p.get("key")
        if key:
            photo_keys.append(key)
            all_keys.append(key)
            if p.get("status") == "ready":
                ready.append(key)
                ready_keys.append(key)
        tk = p.get("thumbKey")
        if tk:
            thumbs.append(tk)
            all_keys.append(tk)
    items_out.append({
        "itemId": item_id,
        "pk": item.get("pk"),
        "sk": sk,
        "photoKeys": photo_keys,
        "readyPhotoKeys": ready,
        "thumbKeys": thumbs,
    })
inv = {
    "exportedAt": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "exportDateUtc": date_utc,
    "environment": env,
    "tableName": table,
    "mediaBucket": media,
    "metaAttrOptions": meta,
    "itemCount": len(items_out),
    "counts": {
        "items": len(items_out),
        "readyPhotoKeys": len(ready_keys),
        "uniqueReadyPhotoKeys": len(set(ready_keys)),
        "allReferencedKeys": len(set(all_keys)),
    },
    "items": items_out,
}
Path(inv_path).write_text(json.dumps(inv, indent=2) + "\n", encoding="utf-8")
PY
fi

REPORT_JSON="$WORK/diff.json"
python3 - "$BASELINE" "$CURRENT" "$REPORT_JSON" "$ENV" "$CHECK_OBJECTS" "$REGION" <<'PY'
import json, sys, subprocess
from pathlib import Path

baseline_path, current_path, out_path, env, check_objects, region = sys.argv[1:7]
check_objects = check_objects == "1"
base = json.loads(Path(baseline_path).read_text(encoding="utf-8"))
cur = json.loads(Path(current_path).read_text(encoding="utf-8"))

def by_id(inv):
    return {i["itemId"]: i for i in inv.get("items") or []}

b_map = by_id(base)
c_map = by_id(cur)
missing_ids = sorted(set(b_map) - set(c_map))
extra_ids = sorted(set(c_map) - set(b_map))

items_missing_photos = []
for iid, b_item in b_map.items():
    if iid not in c_map:
        continue
    b_ready = set(b_item.get("readyPhotoKeys") or [])
    c_ready = set(c_map[iid].get("readyPhotoKeys") or [])
    lost = sorted(b_ready - c_ready)
    if lost:
        items_missing_photos.append({"itemId": iid, "missingReadyPhotoKeys": lost})

base_ready = set()
for i in base.get("items") or []:
    base_ready.update(i.get("readyPhotoKeys") or [])
cur_ready = set()
for i in cur.get("items") or []:
    cur_ready.update(i.get("readyPhotoKeys") or [])
missing_photo_keys = sorted(base_ready - cur_ready)

object_missing = []
if check_objects and missing_photo_keys:
    media = cur.get("mediaBucket") or base.get("mediaBucket") or f"{env}-dressme-media-bucket"
    for key in missing_photo_keys:
        # Also check keys still referenced but verify presence for recovered items' ready keys sample:
        pass
    # Head every baseline ready key that should exist after restore
    for key in sorted(base_ready):
        r = subprocess.run(
            ["aws", "s3api", "head-object", "--bucket", media, "--key", key, "--region", region],
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            object_missing.append(key)

pre = len(b_map)
# Catalog unit: item present with all baseline ready photo keys either present on item or item had zero ready photos.
recovered = 0
for iid, b_item in b_map.items():
    if iid not in c_map:
        continue
    b_ready = set(b_item.get("readyPhotoKeys") or [])
    c_ready = set(c_map[iid].get("readyPhotoKeys") or [])
    if not b_ready or b_ready.issubset(c_ready):
        # If object check ran, also require objects exist for those keys
        if check_objects and b_ready and any(k in object_missing for k in b_ready):
            continue
        recovered += 1

catalog_pct = (recovered / pre * 100.0) if pre else 100.0
photo_pre = len(base_ready)
photo_ok = photo_pre - len(set(object_missing) & base_ready) if check_objects else photo_pre - len(missing_photo_keys)
photo_pct = (photo_ok / photo_pre * 100.0) if photo_pre else 100.0

meta_base = bool(base.get("metaAttrOptions"))
meta_cur = bool(cur.get("metaAttrOptions"))
if meta_base and meta_cur:
    meta_status = "recovered"
elif meta_base and not meta_cur:
    meta_status = "missing"
elif not meta_base and meta_cur:
    meta_status = "present_but_was_absent_in_baseline"
else:
    meta_status = "absent_both"

report = {
    "environment": env,
    "baselineExportedAt": base.get("exportedAt"),
    "currentExportedAt": cur.get("exportedAt"),
    "metaAttrOptions": meta_status,
    "counts": {
        "baselineItems": pre,
        "currentItems": len(c_map),
        "missingItemIds": len(missing_ids),
        "extraItemIds": len(extra_ids),
        "itemsRestoredMissingPhotos": len(items_missing_photos),
        "missingReadyPhotoKeysVsInventory": len(missing_photo_keys),
        "missingS3ObjectsForBaselineReadyKeys": len(object_missing) if check_objects else None,
    },
    "recoverability": {
        "catalogUnitsPct": round(catalog_pct, 2),
        "catalogUnitsRecovered": recovered,
        "catalogUnitsBaseline": pre,
        "photoKeysPct": round(photo_pct, 2),
        "passT1_ge_90": catalog_pct >= 90.0,
    },
    "missingItemIds": missing_ids,
    "extraItemIds": extra_ids,
    "itemsRestoredMissingPhotos": items_missing_photos,
    "missingReadyPhotoKeys": missing_photo_keys,
    "missingS3Objects": object_missing if check_objects else [],
}
Path(out_path).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report["recoverability"], indent=2))
print(f"missingItemIds={len(missing_ids)} meta={meta_status}")
PY

cp "$REPORT_JSON" "./wardrobe-restore-diff-${ENV}.json"
echo "Wrote ./wardrobe-restore-diff-${ENV}.json"

if [[ -n "$MARKDOWN" ]]; then
  python3 - "$REPORT_JSON" "$MARKDOWN" <<'PY'
import json, sys
from pathlib import Path
from datetime import datetime, timezone
r = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
out = Path(sys.argv[2])
now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
lines = [
  "# Unrecovered-data report",
  "",
  f"- Generated: `{now}`",
  f"- Environment: `{r['environment']}`",
  f"- Baseline inventory: `{r.get('baselineExportedAt')}`",
  f"- Compared to: `{r.get('currentExportedAt')}`",
  f"- META#attrOptions: **{r['metaAttrOptions']}**",
  "",
  "## Recoverability",
  "",
  f"- Catalog units: **{r['recoverability']['catalogUnitsPct']}%** "
  f"({r['recoverability']['catalogUnitsRecovered']}/{r['recoverability']['catalogUnitsBaseline']})",
  f"- Photo keys (secondary): **{r['recoverability']['photoKeysPct']}%**",
  f"- T1 ≥90%: **{'PASS' if r['recoverability']['passT1_ge_90'] else 'FAIL'}**",
  "",
  "## Missing itemIds",
  "",
]
if r["missingItemIds"]:
  lines += [f"- `{i}`" for i in r["missingItemIds"]]
else:
  lines.append("_None_")
lines += ["", "## Items restored with missing ready photo keys", ""]
if r["itemsRestoredMissingPhotos"]:
  for row in r["itemsRestoredMissingPhotos"]:
    lines.append(f"- `{row['itemId']}`: " + ", ".join(f"`{k}`" for k in row["missingReadyPhotoKeys"]))
else:
  lines.append("_None_")
lines += ["", "## Baseline ready keys with no S3 object", ""]
if r.get("missingS3Objects"):
  lines += [f"- `{k}`" for k in r["missingS3Objects"]]
else:
  lines.append("_None_ (or object check skipped)")
lines += ["", "## Follow-ups", "", "- [ ] Re-photograph / re-upload listed keys", "- [ ] Confirm Cognito USER# partition", ""]
out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"Wrote {out}")
PY
fi
