# Origin-verify secret rotation

DressMe only accepts traffic that arrives through Cloudflare. Cloudflare injects
`X-Origin-Verify`; a CloudFront Function rejects any other value (including direct
`*.cloudfront.net` hits).

The same secret is stored in **two places** (gitignored `terraform.tfvars` only):

| Side | Root | Variable(s) |
|------|------|-------------|
| Inject header | [`7oas7er/platform`](https://github.com/7oas7er/platform) `infra/terraform/shared-edge` | `dressme_stg_origin_verify_secret` / `dressme_prod_origin_verify_secret` (and Netrunner vars for sibling hosts) |
| Accept header | this repo `infra/terraform/aws/envs/{stg\|prod}` | `origin_verify_secret` (+ optional `origin_verify_secret_previous`) |

Prefer **distinct secrets per environment**. Never commit real values. The secret also
appears in Terraform state and in the published CloudFront Function source for anyone
with `cloudfront:DescribeFunction` / `GetFunction`.

## Why dual-accept

Updating only one side first causes **site-wide 403s**. The AWS Function can accept
**current and previous** secrets during cutover so rotation is zero-downtime.

## Rotate one environment (recommended)

Do **stg first**, then **prod**. Keep each env’s secret different.

### 0. Prep

```bash
# Strong random secret (example); store offline until both tfvars are updated.
openssl rand -base64 32
```

Have AWS profile `7oas7er` and `CLOUDFLARE_API_TOKEN` ready. Confirm Grafana/synthetic
checks for that env are green before and after.

### 1. Dual-accept on AWS (old + new)

In `infra/terraform/aws/envs/<env>/terraform.tfvars`:

```hcl
origin_verify_secret          = "<NEW_SECRET>"
origin_verify_secret_previous = "<OLD_SECRET>"
```

```bash
cd infra/terraform/aws/envs/<env>   # stg or prod
terraform apply
```

Confirm plan updates only `aws_cloudfront_function.origin_verify` (and the distribution
association if the function ARN/etag changes). Site must still work (Cloudflare still
sends the old secret).

### 2. Point Cloudflare at the new secret

In platform `shared-edge` `terraform.tfvars`, set
`dressme_stg_origin_verify_secret` or `dressme_prod_origin_verify_secret` to
`<NEW_SECRET>`.

```bash
cd /path/to/platform/infra/terraform/shared-edge
terraform apply
```

Confirm plan updates only the origin-verify ruleset header value for that env.

### 3. Verify

- Browser: `https://dressme-stg.7oas7er.com` or `https://dressme.7oas7er.com` loads.
- API: `GET /api/health` returns 200 through Cloudflare.
- Direct CloudFront hostname still returns **403**.
- Optional: Grafana synthetic checks for that env stay green for one interval.

### 4. Drop the previous secret on AWS

In the AWS env `terraform.tfvars`:

```hcl
origin_verify_secret = "<NEW_SECRET>"
# origin_verify_secret_previous = null   # or delete the line
```

```bash
cd infra/terraform/aws/envs/<env>
terraform apply
```

Confirm Function code no longer contains the old secret (AWS console → CloudFront →
Functions, or `terraform plan` shows no drift afterward).

### 5. Prod

Repeat steps 1–4 for production with a **different** new secret.

## Emergency / accept brief 403s

If you cannot dual-accept (for example Function publish stuck), update **Cloudflare then
AWS** as fast as possible (or the reverse). Expect a short 403 window. Prefer dual-accept
whenever you can.

## Rollback

1. Set the platform `shared-edge` origin-verify var back to the old secret → `terraform apply` there.
2. On AWS, set `origin_verify_secret` to the old value and clear
   `origin_verify_secret_previous` → `terraform apply`.

If AWS is still dual-accepting (new + old) and only shared-edge was switched, rolling
shared-edge back alone restores traffic immediately.

## What not to do

- Do not put secrets in git, GitHub Actions, or Cursor rules.
- Do not reuse the same secret for stg and prod.
- Do not leave `origin_verify_secret_previous` set longer than needed (widens the
  acceptance window if the old value leaks).
- Do not rotate by editing the CloudFront Function or Cloudflare rule only in the
  console — re-apply Terraform afterward or state will drift.
