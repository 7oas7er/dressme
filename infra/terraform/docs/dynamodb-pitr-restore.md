# DynamoDB + media restore (technical)

Operator overview (plain language): [`docs/runbook.md`](../../../docs/runbook.md) — **Backup and restore**.

The wardrobe items table (`{env}-dressme-items-table`) has **point-in-time recovery (PITR)** and **deletion protection** (`modules/site/dynamodb.tf`). Media (`{env}-dressme-media-bucket`) has **versioning**, **90-day noncurrent expiry**, and **`prevent_destroy`**. Cold weekly packages live in `{env}-dressme-backup-bucket` (`modules/site/backup.tf`).

CI does **not** apply Terraform. Ops work is local with `AWS_PROFILE=7oas7er` ([ADR 0003](../../../docs/adr/0003-local-terraform-apply.md)).

---

## Path A — Hot restore (preferred inside windows)

### Dynamo PITR → new table

1. Note earliest restore time and table status:

   ```bash
   export AWS_PROFILE=7oas7er AWS_DEFAULT_REGION=eu-north-1
   aws dynamodb describe-continuous-backups --table-name stg-dressme-items-table
   ```

2. Restore to a **new** table (does not overwrite in place):

   ```bash
   aws dynamodb restore-table-to-point-in-time \
     --source-table-name stg-dressme-items-table \
     --target-table-name stg-dressme-items-table-restore-YYYYMMDD \
     --use-latest-restorable-time
   # Or: --restore-date-time 2026-11-13T10:00:00Z
   ```

3. Wait until the new table is `ACTIVE`. Compare item counts / sample `USER#…` / `ITEM#…` and `META#attrOptions`.

4. Cut over only after Frank confirms:
   - Prefer swapping Lambda env `ITEMS_TABLE` (and Terraform `aws_dynamodb_table.items`) to the restored table, **or**
   - Copy selected items back into the live table if blast radius is small.
   - Import / replace Terraform state so the next `plan` matches reality.

5. Re-smoke catalog CRUD + Analyze / Suggest on https://dressme-stg.7oas7er.com/ before any prod restore.

### Media — version undelete / rollback

Accidental delete creates a **delete marker**; prior versions remain until the 90-day noncurrent lifecycle expires.

```bash
# List versions for a key
aws s3api list-object-versions --bucket stg-dressme-media-bucket --prefix 'users/…/items/…/'

# Remove a delete marker (restores current object to the previous version)
aws s3api delete-object \
  --bucket stg-dressme-media-bucket \
  --key 'users/…/photo.jpg' \
  --version-id '<DELETE_MARKER_VERSION_ID>'

# Or copy a specific prior version back as current
aws s3api copy-object \
  --bucket stg-dressme-media-bucket \
  --copy-source 'stg-dressme-media-bucket/users/…/photo.jpg?versionId=VERSION' \
  --key 'users/…/photo.jpg'
```

Mass wipe of **all versions** cannot be undone from versioning alone — use Path B (cold copy).

---

## Path B — Cold weekly package

Package layout (written by `scripts/wardrobe-backup.sh`):

```text
s3://{env}-dressme-backup-bucket/weekly/YYYY-MM-DD/
  inventory.json
  dynamodb.jsonl
  media/…   (object keys preserved under media/)
```

### Reload Dynamo from `dynamodb.jsonl`

1. Create a scratch table with the same key schema (`pk`/`sk` strings, on-demand) **or** use a temporary restore table name.
2. Convert AttributeValue JSON lines and `BatchWriteItem` in chunks of ≤25. Example sketch (operator-owned; validate on stg):

   ```bash
   # Inspect row count
   wc -l dynamodb.jsonl
   # Import: use AWS Console Import, or a small local loop with BatchWriteItem.
   # Prefer restoring into a new table, then swap ITEMS_TABLE after verify.
   ```

3. Confirm `ITEM#` count vs `inventory.json` and that `META#attrOptions` exists (or document as missing).

### Reload media from cold sync

```bash
aws s3 sync \
  s3://stg-dressme-backup-bucket/weekly/YYYY-MM-DD/media/ \
  s3://stg-dressme-media-bucket/ \
  --region eu-north-1
```

Use `--dryrun` first. Do not sync the wrong env’s package into prod.

### Cognito `sub` / `USER#`

Items use `pk = USER#<cognito-sub>`. If the pool/user still exists, no rewrite. If you recreated the user, rewrite `pk` (and any userId fields) to the new `sub` before cutover — same idea as the 2026-11-11 production cutover dump.

---

## Unrecovered-data report (T2)

Template: [`docs/templates/unrecovered-data-report.md`](../../../docs/templates/unrecovered-data-report.md).

```bash
./scripts/wardrobe-restore-diff.sh --env stg \
  --inventory s3://stg-dressme-backup-bucket/weekly/YYYY-MM-DD/inventory.json \
  --markdown ./unrecovered-stg.md
```

Catalog-unit recoverability ≥90% is the T1 gate; photo-key % is secondary. `META#attrOptions` is reported separately.

---

## Weekly backup (operator)

```bash
./scripts/wardrobe-backup.sh --env stg|prod
./scripts/wardrobe-backup.sh --env stg --dry-run
```

IAM: attach Terraform output `wardrobe_backup_policy_arn`, or use admin profile `7oas7er`.

---

## Non-goals

- AWS Backup organization plans / vault lock.
- Cross-region replication / Object Lock (cost + friction vs €10 ceiling).
- Automated restore in CI.
- Applying Terraform from GitHub Actions.
