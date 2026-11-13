# Bedrock outfit suggest — Mac apply / smoke (stg)

UC-04 / UC-09 (DM-44): Cognito-gated `POST /api/suggest` → Bedrock **text** Converse in `eu-north-1` over catalog attrs + `aiContext` (no photos). Reuses Analyze model pin + IAM ([ADR 0009](../../../docs/adr/0009-bedrock-analyze-iam.md)). CI plans Terraform only — **apply locally** ([ADR 0003](../../../docs/adr/0003-local-terraform-apply.md)).

## Before cutover

1. Merge the UC-04 implementation PR to `staging` (SPA deploys via Actions **Publish to S3**).
2. **Apply AWS stg Terraform** so the Lambda zip includes `context`. Site deploy alone does **not** update Lambda — without apply, Recommend posts `{ context }` and an old function that still required `occasion` returns `missing_occasion`. SPA and Lambda both use `context` only now (legacy occasion/weather shim dropped).
3. Confirm Analyze already works on stg (same `BEDROCK_MODEL_ID` / IAM).
4. Optional smoke **before** flipping the default engine: signed-in browser or API with body `{ "context": "…", "engine": "bedrock" }` while `SUGGEST_ENGINE` is still `random`.

## Flip default to Bedrock (stg)

`envs/stg/main.tf` pins `suggest_engine = "bedrock"` on the site module so routine
stg applies keep Lambda `SUGGEST_ENGINE=bedrock` (module default is still `random`
for prod / rollback). If Recommend shows “Random assembly…”, confirm live Lambda
env and re-apply stg after that pin is present.

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
- Lambda env `SUGGEST_MODEL_ID` when stg pins Sonnet (Analyze stays on `BEDROCK_MODEL_ID` / Haiku). Stg trial pin: `eu.anthropic.claude-sonnet-4-6` (active). Do **not** re-pin `eu.anthropic.claude-sonnet-4-5-20250929-v1:0` — that FM is LEGACY and Bedrock denies accounts without recent use (`ResourceNotFoundException` → SPA `suggest_unavailable`).
- IAM invoke ARNs for Analyze + Suggest model families (CRIS FM destinations)
- New suggest code in the zip when `infra/lambda` changed (Lambda source only lands via this apply — not via site deploy)

**Rollback engine:** set `suggest_engine = "random"`, `terraform apply`. Do **not** rely on silent random-on-error — Bedrock failures return 502/503 `suggest_unavailable`.

**Rollback Suggest model (stg Sonnet trial):** set `suggest_model_id = ""` (falls back to Haiku) or an explicit Haiku profile id, then `terraform apply`. Prod stays on Haiku unless Frank pins Sonnet there later.

## Smoke (stg)

1. Open https://dressme-stg.7oas7er.com/ and sign in (catalog should already have attrs + `aiContext` from Analyze).
2. **Suggest outfits** → single **Context** field (e.g. `client lunch, cool and dry`) → **Dress me**.
3. Expect N photos-only look cards (enlarged piece thumbs + optional Wada plate + AI title; N from context, default 3, clamp 1–8); rationale **below** the look body. Incomplete looks are repaired locally (core / cold layer / waist finish) and backfilled when unused pieces remain; if still short, SPA shows a one-line shortfall note (`lookCountShortfall`). Only when **zero** complete looks can be assembled do we 502 `suggest_incomplete_looks`.
4. Engine line: “AI suggestions from your catalog”. Cold outdoor / garden contexts should layer when the closet has outerwear; looped trousers should get a belt (or suspenders when `aiContext` supports them).
5. CloudWatch: one `suggest_success` JSON line with `suggestionId`, `modelId`, token counts, look-count / repair counters — **no** prompt/context/catalog dump.
6. After changing `infra/lambda/suggest.js` or Suggest model pin, apply AWS Terraform locally so the Lambda zip + env/IAM pick up the change (site deploy alone does not).

## Prod

Only after Frank asks to promote `staging` → `main`, then the same `suggest_engine = "bedrock"` apply under `envs/prod`.

## Timeouts (edge vs Lambda)

| Layer | Limit | Notes |
|-------|-------|-------|
| CloudFront → Lambda Function URL `origin_read_timeout` | **60s** (AWS max without quota) | Binding edge timeout for `/api/*`. Default 30s caused SPA `http_504` on Sonnet Suggest while Lambda still logged `suggest_success` (~37s, 4 looks, 2 Bedrock calls). |
| Lambda `timeout` | 90s | Still higher than CF; unused headroom unless AWS raises the CF quota. |
| Suggest optional 2nd Bedrock pass | skipped after ~40s wall clock | Repair/fill only; primary + JSON-repair still run. Local layer/waist repair + deterministic backfill continue. |

If Suggest still 504s after a 60s CF apply, either shorten the catalog prompt / look count or request a CloudFront origin-read quota increase (up to 180s).

## Cost note

Text Haiku suggest is typically cents/month at personal volume. Multimodal cost stays on Analyze (once per item care), not on every suggest. Sonnet Suggest + large catalogs costs more and is slower — watch CloudWatch Duration vs the 60s edge cap.
