# Unrecovered-data report

Fill this after every restore attempt (or generate a draft with `scripts/wardrobe-restore-diff.sh --markdown …`).

| Field | Value |
|-------|-------|
| Incident id | |
| Environment | `stg` / `prod` |
| Restore path | A (PITR + S3 versions) / B (cold weekly package) |
| Loss detected (UTC) | |
| Restore point / package used | |
| Restore completed (UTC) | |
| Pre-loss inventory source | e.g. `s3://…/weekly/YYYY-MM-DD/inventory.json` |

## Recoverability

| Metric | Value |
|--------|-------|
| Catalog units recovered / baseline | /  (≥90% = T1 pass) |
| Catalog recoverability % | |
| Ready photo keys recovered / baseline | / |
| Photo-key recoverability % (secondary) | |
| `META#attrOptions` | recovered / missing / n/a |

## Missing itemIds

_List wardrobe items present in the pre-loss inventory but not after restore._

-

## Items restored without one or more ready photo keys

| itemId | Missing keys |
|--------|----------------|
| | |

## Photo keys in inventory with no S3 object

-

## Orphans restored but unreferenced (optional)

-

## Residual risk / follow-ups

- [ ] Re-photograph list for Frank
- [ ] Cognito `USER#` / `sub` check
- [ ] Smoke: `/api/health`, signed-in catalog, one Suggest
- [ ] Next weekly backup after cutover

## Notes

_
