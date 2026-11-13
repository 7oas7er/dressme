#!/usr/bin/env bash
# Weekly (or ad-hoc) cold backup of DressMe wardrobe data.
# Writes inventory + DynamoDB Scan dump + media sync into {env}-dressme-backup-bucket.
#
# Usage:
#   export AWS_PROFILE=7oas7er AWS_DEFAULT_REGION=eu-north-1
#   ./scripts/wardrobe-backup.sh --env stg
#   ./scripts/wardrobe-backup.sh --env prod --dry-run
#   ./scripts/wardrobe-backup.sh --env stg --skip-media
#   ./scripts/wardrobe-backup.sh --env stg --local-dir /tmp/dressme-backup
#
# Requires: aws CLI, jq, python3 (stdlib only). See docs/runbook.md.

set -euo pipefail

ENV=""
DRY_RUN=0
SKIP_MEDIA=0
LOCAL_DIR=""
REGION="${AWS_DEFAULT_REGION:-eu-north-1}"
PROMOTE_MONTHLY=1

usage() {
  cat <<'EOF'
Usage: wardrobe-backup.sh --env stg|prod [--dry-run] [--skip-media] [--local-dir DIR] [--no-monthly]

Creates a dated package under s3://{env}-dressme-backup-bucket/weekly/YYYY-MM-DD/
(and copies to monthly/YYYY-MM/ on the first run of each calendar month unless --no-monthly).

Artifacts:
  inventory.json   itemIds, photo keys, counts, timestamp
  dynamodb.jsonl   full table Scan (one Dynamo item per line)
  media/           aws s3 sync of current media objects (unless --skip-media)

Idempotent for the same calendar day (re-run overwrites that day's prefix).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --skip-media)
      SKIP_MEDIA=1
      shift
      ;;
    --local-dir)
      LOCAL_DIR="${2:-}"
      shift 2
      ;;
    --no-monthly)
      PROMOTE_MONTHLY=0
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
  usage >&2
  exit 2
fi

for cmd in aws jq python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
done

TABLE="${ENV}-dressme-items-table"
MEDIA_BUCKET="${ENV}-dressme-media-bucket"
BACKUP_BUCKET="${ENV}-dressme-backup-bucket"
DATE_UTC="$(date -u +%Y-%m-%d)"
MONTH_UTC="$(date -u +%Y-%m)"
WEEKLY_PREFIX="weekly/${DATE_UTC}"
MONTHLY_PREFIX="monthly/${MONTH_UTC}"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/dressme-backup.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

DUMP="$WORK/dynamodb.jsonl"
INVENTORY="$WORK/inventory.json"

echo "Env=$ENV table=$TABLE media=$MEDIA_BUCKET backup=$BACKUP_BUCKET date=$DATE_UTC"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] Would Scan $TABLE, write inventory, sync media → s3://$BACKUP_BUCKET/$WEEKLY_PREFIX/"
  aws s3api head-bucket --bucket "$BACKUP_BUCKET" --region "$REGION" >/dev/null
  aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" --query 'Table.TableStatus' --output text
  echo "[dry-run] Backup bucket and table reachable. Exiting without writes."
  exit 0
fi

echo "Scanning DynamoDB → $DUMP"
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

ITEM_LINES="$(grep -c . "$DUMP" || true)"
echo "Scanned $ITEM_LINES Dynamo items"

python3 - "$DUMP" "$INVENTORY" "$ENV" "$TABLE" "$MEDIA_BUCKET" "$DATE_UTC" <<'PY'
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
    photo_keys = []
    ready = []
    thumbs = []
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
        "dynamoRows": sum(1 for _ in Path(dump_path).read_text(encoding="utf-8").splitlines() if _.strip()),
        "readyPhotoKeys": len(ready_keys),
        "uniqueReadyPhotoKeys": len(set(ready_keys)),
        "allReferencedKeys": len(set(all_keys)),
    },
    "items": items_out,
}
Path(inv_path).write_text(json.dumps(inv, indent=2) + "\n", encoding="utf-8")
print(f"Inventory: {inv['itemCount']} items, metaAttrOptions={meta}, readyPhotoKeys={inv['counts']['readyPhotoKeys']}")
PY

upload_prefix() {
  local prefix="$1"
  echo "Uploading package → s3://$BACKUP_BUCKET/$prefix/"
  aws s3 cp "$INVENTORY" "s3://$BACKUP_BUCKET/$prefix/inventory.json" --region "$REGION"
  aws s3 cp "$DUMP" "s3://$BACKUP_BUCKET/$prefix/dynamodb.jsonl" --region "$REGION"
  if [[ "$SKIP_MEDIA" -eq 0 ]]; then
    aws s3 sync "s3://$MEDIA_BUCKET" "s3://$BACKUP_BUCKET/$prefix/media/" \
      --region "$REGION" \
      --only-show-errors
  else
    echo "Skipping media sync (--skip-media)"
  fi
}

upload_prefix "$WEEKLY_PREFIX"

if [[ "$PROMOTE_MONTHLY" -eq 1 ]]; then
  # First weekly of the month (or re-run) refreshes monthly/YYYY-MM.
  echo "Refreshing monthly snapshot → s3://$BACKUP_BUCKET/$MONTHLY_PREFIX/"
  aws s3 sync "s3://$BACKUP_BUCKET/$WEEKLY_PREFIX/" "s3://$BACKUP_BUCKET/$MONTHLY_PREFIX/" \
    --region "$REGION" \
    --only-show-errors
fi

if [[ -n "$LOCAL_DIR" ]]; then
  DEST="$LOCAL_DIR/$ENV/$DATE_UTC"
  mkdir -p "$DEST"
  cp "$INVENTORY" "$DEST/inventory.json"
  cp "$DUMP" "$DEST/dynamodb.jsonl"
  echo "Also copied inventory + dump to $DEST (media stays in S3 unless you sync separately)"
fi

echo "Done. Package: s3://$BACKUP_BUCKET/$WEEKLY_PREFIX/"
echo "Verify: aws s3 ls s3://$BACKUP_BUCKET/$WEEKLY_PREFIX/ --region $REGION"
