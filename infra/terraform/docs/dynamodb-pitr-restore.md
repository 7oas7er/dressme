# DynamoDB PITR restore stub

The wardrobe items table (`{env}-dressme-items-table`) has **point-in-time recovery (PITR)** enabled in Terraform (`modules/site/dynamodb.tf`). Use this only after accidental deletes or corruption — not for routine “undo.”

CI does **not** apply Terraform. Ops work is local with `AWS_PROFILE=7oas7er` ([ADR 0003](../../../docs/adr/0003-local-terraform-apply.md)).

## Restore outline (stg first)

1. Note the **earliest restore time** and table ARN/name from the console or CLI (`aws dynamodb describe-continuous-backups --table-name …`).
2. Create a **new** table from PITR (restore does not overwrite in place), e.g. console → DynamoDB → Backups → Restore to point in time, or `aws dynamodb restore-table-to-point-in-time`.
3. Verify item counts / sample `USER#…` partitions on the restored table.
4. Cut over carefully:
   - Prefer swapping Lambda `ITEMS_TABLE` (and Terraform `aws_dynamodb_table.items`) only after Frank confirms the restore table is good.
   - Or copy selected items back into the live table if the blast radius is small.
5. Update Terraform state / resource if the live table name or ARN changes (import or replace) so the next `plan` matches reality.
6. Re-smoke catalog CRUD + Analyze on https://dressme-stg.7oas7er.com/ before any prod restore.

## Non-goals

- AWS Backup plans beyond PITR (solo v1).
- Automated restore scripts in CI.
- Changing deletion protection / IAM in this doc — those live in `dynamodb.tf` / other PRs.
