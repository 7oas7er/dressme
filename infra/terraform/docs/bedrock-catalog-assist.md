# Bedrock add-time catalog assist — Mac apply (stg)

UC-25 / DM-43: Cognito-gated `POST /api/items/analyze` → Bedrock multimodal in `eu-north-1`. CI plans Terraform only — **apply locally** ([ADR 0003](../../../docs/adr/0003-local-terraform-apply.md)).

## Before apply

1. **Model access** in the AWS account (`eu-north-1`): enable Claude Haiku 4.5 (or the model ID in `bedrock_model_id`) via Bedrock console → Model access / inference profiles.
2. Confirm the default inference profile ID still matches:

   `eu.anthropic.claude-haiku-4-5-20251001-v1:0`

   Override with module/env `bedrock_model_id` if AWS renames the profile.

## Apply (stg)

```bash
export AWS_PROFILE=7oas7er
cd infra/lambda && npm run ci
cd ../terraform/aws/envs/stg
terraform init -reconfigure   # if needed
terraform plan
terraform apply
```

What this updates:

- Lambda IAM: `bedrock:InvokeModel` on the eu-north-1 inference profile **and** EU foundation-model ARNs the profile may route to (`eu-central-1/2`, `eu-west-1/3`, `eu-south-1/2`, plus home region). Omitting a CRIS destination (e.g. `eu-south-2`) surfaces as SPA **502** / `analyze_unavailable`.
- Lambda env: `BEDROCK_REGION`, `BEDROCK_MODEL_ID`, `SUGGEST_ENGINE=random`
- Timeout 90s; new analyze code in the zip when `infra/lambda` changed

SPA deploys on merge via Actions; **analyze will 502 until this apply + model access succeed**.

## Smoke

1. Open https://dressme-stg.7oas7er.com/ and sign in.
2. **Add item** → choose a clear garment photo → **Analyze photo**.
3. Review proposals → **Apply to form** → edit if needed → **Save item**.
4. Re-open the item: attrs + AI context note should persist.

## Prod

Only after Frank asks to promote `staging` → `main`, then the same apply under `envs/prod` (model access is account-wide; IAM/env still need prod apply).

## Cost note

One multimodal call per Analyze click. Outfit suggest stays random (`SUGGEST_ENGINE=random`) until DM-44.
