# Bedrock outfit suggest — Mac apply / smoke (stg)

UC-04 / UC-09 (DM-44): Cognito-gated `POST /api/suggest` → Bedrock **text** Converse in `eu-north-1` over catalog attrs + `aiContext` (no photos). Reuses Analyze model pin + IAM ([ADR 0009](../../../docs/adr/0009-bedrock-analyze-iam.md)). CI plans Terraform only — **apply locally** ([ADR 0003](../../../docs/adr/0003-local-terraform-apply.md)).

## Before cutover

1. Merge the UC-04 implementation PR to `staging` (SPA deploys via Actions **Publish to S3**).
2. **Apply AWS stg Terraform** so the Lambda zip includes `context` (+ occasion shim). Site deploy alone does **not** update Lambda — without apply, Recommend posts `{ context }` and the live function still returns `missing_occasion`. The SPA dual-writes `occasion` for that window; apply clears the mismatch.
3. Confirm Analyze already works on stg (same `BEDROCK_MODEL_ID` / IAM).
4. Optional smoke **before** flipping the default engine: signed-in browser or API with body `{ "context": "…", "engine": "bedrock" }` while `SUGGEST_ENGINE` is still `random`.

## Flip default to Bedrock (stg)

In `infra/terraform/aws/envs/stg`, pass the module override (or set via whatever pattern you use for site vars):

```hcl
module "site" {
  # …
  suggest_engine = "bedrock"
}
```

Then:

```bash
export AWS_PROFILE=7oas7er
cd infra/lambda && npm run ci
cd ../terraform/aws/envs/stg
terraform init -reconfigure   # if needed
terraform plan
terraform apply
```

What this updates:

- Lambda env `SUGGEST_ENGINE=bedrock` (default for all clients)
- New suggest code in the zip when `infra/lambda` changed (Lambda source only lands via this apply — not via site deploy)

**Rollback:** set `suggest_engine = "random"`, `terraform apply`. Do **not** rely on silent random-on-error — Bedrock failures return 502/503 `suggest_unavailable`.

## Smoke (stg)

1. Open https://dressme-stg.7oas7er.com/ and sign in (catalog should already have attrs + `aiContext` from Analyze).
2. **Suggest outfits** → single **Context** field (e.g. `client lunch, cool and dry`) → **Dress me**.
3. Expect three Option D cards; each with rationale text **below** the mannequin+strip (no overlays on the SVG).
4. Engine line: “AI suggestions from your catalog”.
5. CloudWatch: one `suggest_success` JSON line with `suggestionId`, `modelId`, token counts — **no** prompt/context/catalog dump.

## Prod

Only after Frank asks to promote `staging` → `main`, then the same `suggest_engine = "bedrock"` apply under `envs/prod`.

## Cost note

Text Haiku suggest is typically cents/month at personal volume. Multimodal cost stays on Analyze (once per item care), not on every suggest.
