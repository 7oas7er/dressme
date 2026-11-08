# Photo rotate on edit — Mac apply (stg)

UC-18 rotate: Cognito-gated `POST /api/items/{itemId}/photos/{photoId}/rotate` with `{ "degrees": 90 }`. CI plans Terraform only — **apply locally** ([ADR 0003](../../../docs/adr/0003-local-terraform-apply.md)).

## Why SPA alone is not enough

Merge of the rotate PR updates the **site** via Actions (`dressme/**` → S3/CDN). The API Lambda zip updates **only** when AWS env Terraform is applied (`source_code_hash` from `infra/lambda`).

Without that apply, Edit shows the rotate arrow (new SPA) but the live function has no rotate route and returns **`404 { "error": "not_found" }`**.

Quick probe (no auth):

| Request | Route deployed | Route missing |
|---------|----------------|---------------|
| `GET /api/items/{id}/photos/{photoId}/rotate` | `401 unauthorized` (auth runs first) | `404 not_found` |
| `GET /api/items/{id}/photos/complete` | `401 unauthorized` | (n/a — already shipped) |

## Apply (stg)

```bash
export AWS_PROFILE=7oas7er
cd infra/lambda && npm run ci
cd ../terraform/aws/envs/stg
terraform init -reconfigure   # if needed
terraform plan                # expect aws_lambda_function.high_scores source_code_hash change
terraform apply
```

What this updates:

- New rotate handler + thumbs helper in the Lambda zip
- No IAM / env var changes required for rotate (reuses media Get/Put/Delete)

## Smoke (stg)

1. Hard-refresh https://dressme-stg.7oas7er.com/ (SPA already has the overlay after site deploy).
2. Catalog → Edit item → tap lower-right rotate on a ready photo.
3. Expect tile refresh (new presigned `url` / `thumbUrl`); catalog thumb and suggest strip match after leaving Edit.
4. Optional: unauthenticated `GET …/rotate` should now be **401**, not 404.

## Prod

Only after Frank asks to promote `staging` → `main`, then the same apply under `envs/prod`.
