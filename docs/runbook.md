# DressMe operator runbook

Plain-language ops notes for Frank. Deeper Terraform / AWS detail lives under [`infra/terraform/docs/`](../infra/terraform/docs/).

Local AWS profile: `export AWS_PROFILE=7oas7er` · Region: `eu-north-1` · Apply is local only ([ADR 0003](adr/0003-local-terraform-apply.md)).

---

## Backup and restore

This chapter covers **wardrobe data only** (DynamoDB items + media photos). The SPA is recovered by redeploying from git. Cognito is “recreate the user and sign in,” not a byte restore of the user pool.

### What is already protected

| Layer | What it does | How long |
|-------|----------------|----------|
| **Dynamo PITR** | Continuous backup of the items table — undo accidental deletes or bad writes | ~35 days (AWS default) |
| **Media versioning** | Deleted/overwritten photos keep prior versions | Noncurrent versions ~90 days |
| **Weekly cold copy** | Inventory + full table dump + media sync into a **separate** backup bucket | Last ~4 weekly packages + ~1 year of monthly snapshots |

Together these meet the “minimal adequate” bar in the Project concept (T1 ≥90% recoverability, unrecovered report, same business day) **without** multi-region replication or AWS Backup org plans.

**Accepted residual risk:** losing live eu-north-1 resources **and** the cold backup bucket / any offline copy at the same time (e.g. full account wipe).

### When to use which path

| Situation | Path | Why |
|-----------|------|-----|
| Deleted a few items or photos by mistake | **A — Hot** (PITR and/or S3 version undelete) | Fastest; live backups still intact |
| Bad bulk edit / wrong attributes | **A — Hot** (PITR to before the bad write) | Media usually untouched |
| Live table or media bucket destroyed / emptied, but weekly backup exists | **B — Cold** (reload from backup bucket) | PITR/versions may be gone with the resource |
| Outside PITR / version windows and no cold package | Best effort only | Run inventory diff; expect <90% |

Always practice on **staging** before production when the blast radius is large.

### Weekly backup (how to run / where artifacts land)

After Terraform has created `{env}-dressme-backup-bucket` (apply stg/prod once for this feature):

```bash
export AWS_PROFILE=7oas7er AWS_DEFAULT_REGION=eu-north-1
./scripts/wardrobe-backup.sh --env stg          # or --env prod
./scripts/wardrobe-backup.sh --env stg --dry-run  # connectivity check only
```

**Artifacts** land in:

- `s3://{env}-dressme-backup-bucket/weekly/YYYY-MM-DD/`
  - `inventory.json` — itemIds, photo keys, counts, timestamp
  - `dynamodb.jsonl` — full table Scan dump
  - `media/` — sync of current media objects
- Same content also refreshed under `monthly/YYYY-MM/` (lifecycle keeps ~400 days)

Optional: `--local-dir ~/dressme-backups` copies inventory + dump to disk; `--skip-media` skips the S3 sync.

**IAM:** admin profile `7oas7er` is enough. For a scoped identity, attach the Terraform output `wardrobe_backup_policy_arn` (`{env}-dressme-wardrobe-backup-policy`).

**Cadence:** once a week (and before risky Terraform that renames/replaces table or media). Add a calendar reminder; there is no CI job for this (local scripts only).

Lifecycle: weekly prefixes expire after **35 days**; monthly after **400 days**.

### How to restore (order of operations)

**1. Declare the incident**  
Stop catalog writes if you can (don’t keep adding items while restoring). Note the time you noticed the loss.

**2. Choose path A or B** (table above). Prefer A if PITR / media versions still cover the damage.

**3. Restore Dynamo to a *new* table — never overwrite blind**

- Path A: AWS Console → DynamoDB → Backups → Restore to point in time, **or** CLI `restore-table-to-point-in-time`. Details: [`infra/terraform/docs/dynamodb-pitr-restore.md`](../infra/terraform/docs/dynamodb-pitr-restore.md).
- Path B: create/empty a scratch table, then BatchWrite from `dynamodb.jsonl` in the weekly package (see technical doc). Keep the live table name until you verify.

**4. Restore media**

- Path A: remove delete markers / copy prior versions for affected keys (see media section in the technical doc).
- Path B: `aws s3 sync` from `s3://…/weekly/DATE/media/` back to `{env}-dressme-media-bucket`.

**5. Cognito / `USER#` partition**  
Items are keyed by Cognito `sub`. If you recreated the user pool or user, either restore into the existing `USER#<sub>` or rewrite `pk` like the 2026-11-11 cutover. If the same pool/user still exists, skip this.

**6. Stop and verify before cutover**

- Item count vs pre-loss inventory (explain any delta).
- Spot-check several items: attributes + at least one photo loads.
- Confirm `META#attrOptions` or list it as unrecovered.
- `GET /api/health` + signed-in catalog.

**7. Cut over**  
Only after checks look good: point Lambda `ITEMS_TABLE` / Terraform at the restored table (or copy rows back). Re-smoke Suggest once.

**8. Unrecovered-data report**  
Fill [`docs/templates/unrecovered-data-report.md`](templates/unrecovered-data-report.md) or generate a draft:

```bash
./scripts/wardrobe-restore-diff.sh --env stg \
  --inventory s3://stg-dressme-backup-bucket/weekly/YYYY-MM-DD/inventory.json \
  --markdown ./unrecovered-stg.md
```

That script compares the baseline inventory to live state (or `--against` another inventory) and prints catalog-unit recoverability %.

### Staging drill (prove ≤1 business day)

Do **not** run a destructive restore against shared staging without Frank present. Use this checklist when you schedule a drill:

1. [ ] Run `./scripts/wardrobe-backup.sh --env stg` (or `--dry-run` first).
2. [ ] Note package prefix `weekly/YYYY-MM-DD` and item counts from `inventory.json`.
3. [ ] Path A dry practice: `describe-continuous-backups` on `stg-dressme-items-table`; restore **to a new scratch table name** (do not swap Lambda yet).
4. [ ] Compare scratch table item count to inventory; delete the scratch table when done (disable deletion protection on the scratch table only if you created it without protection).
5. [ ] Path A media: pick one deleted test object (or a delete-marker from a deliberate test delete), restore prior version; confirm URL loads.
6. [ ] Run `wardrobe-restore-diff.sh` against the weekly inventory; save Markdown report.
7. [ ] Time the wall clock from “declare drill” to “report written.” Target: within one Berlin business day.
8. [ ] Tear down scratch resources; no lasting change to live `ITEMS_TABLE` or media unless Frank approved a cutover.

### Deeper references

- Dynamo PITR + cold reload detail: [`infra/terraform/docs/dynamodb-pitr-restore.md`](../infra/terraform/docs/dynamodb-pitr-restore.md)
- Unrecovered report template: [`docs/templates/unrecovered-data-report.md`](templates/unrecovered-data-report.md)
- Scripts: [`scripts/wardrobe-backup.sh`](../scripts/wardrobe-backup.sh), [`scripts/wardrobe-restore-diff.sh`](../scripts/wardrobe-restore-diff.sh)
- Terraform: `modules/site/backup.tf`, `media.tf` (`prevent_destroy`), `dynamodb.tf` (PITR + deletion protection)

### Apply notes (backup bucket + media prevent_destroy)

After merging this feature to `staging`:

```bash
export AWS_PROFILE=7oas7er
cd infra/terraform/aws/envs/stg && terraform plan && terraform apply   # when Frank is ready
```

Prod: plan/apply only when promoting / Frank asks — never apply prod from CI. The media bucket now has `lifecycle.prevent_destroy` like the health bucket; intentional replace requires removing that guard first.
