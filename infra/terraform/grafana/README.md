# DressMe — Grafana Cloud observability

Observability for DressMe lives in **Grafana Cloud Free** (synthetics, CloudWatch scrape, Cloudflare edge analytics via GraphQL, GitHub Actions). Cloudflare stays DNS/edge only — metrics are **pulled into** Grafana; do not add a second monitoring SaaS in Cloudflare.

CloudWatch scrape is enabled by default (`enable_cloudwatch_scrape = true`). Org RCP `ManagedAccountResourceControlPolicy` must exempt Grafana Labs account `008923505280` from the outside-org `sts:*` deny, or AssumeRole fails with `aws_authentication_error`.

## What this root manages

| Resource | Purpose |
|----------|---------|
| `shared-dressme-grafana-cloudwatch-role` | IAM role Grafana Labs assumes to read CloudWatch |
| `grafana_cloud_provider_aws_account` | Links the AWS account to the Grafana stack |
| `grafana_cloud_provider_aws_cloudwatch_scrape_job` | Scrapes Lambda + CloudFront metrics |
| Synthetic HTTP checks | Prod/stg site + `/api/health` (prod: ≤2 EU probes @ 5m; stg: 1 probe @ 15m) |
| Infinity data source | Cloudflare GraphQL edge traffic + firewall / rate-limit events (optional until token set) |
| GitHub data source | Actions workflow runs / usage for deploy + terraform-plan (optional until token set) |
| Folder + dashboards `DressMe — Production` / `DressMe — Staging` | Fixed-window traffic/errors/latency + synthetics + Cloudflare edge + GitHub CI |

State key: `grafana/terraform.tfstate` in `shared-dressme-terraform-state-bucket`.

## One-time Grafana setup

1. Create a [Grafana Cloud Free](https://grafana.com/products/cloud/) account and stack.
2. Create a Cloud access policy token with `stacks:read`, `stack-service-accounts:write` (for dashboards), `stack-plugins:read|write|delete` (to install the GitHub plugin), and `integration-management:read|write` for Cloud Provider (or a separate token). Infinity is pre-provisioned on Grafana Cloud — do not try to install it via Terraform (API returns 409).
3. In the stack: **Synthetics → Config** — create an SM access token (`sm_access_token`).
4. Copy `terraform.tfvars.example` → `terraform.tfvars` and fill values (never commit `terraform.tfvars`).
   - IAM trust External ID defaults to the stack `prometheus_user_id`. If account create fails with `aws_authentication_error` and CloudTrail shows no `AssumeRole`, copy the External ID from **Cloud Provider → AWS → Add account** into `grafana_aws_external_id`.
   - Cloud Provider API URL comes from the stack `cloud_provider_url` automatically (do not invent it from `region_slug`; they can differ).
   - Terraform creates a stack service account `dressme-terraform` to publish the DressMe Production and Staging dashboards.

### Cloudflare edge analytics (Free plan)

Infinity DS `infinity-cloudflare` and the analytics token are owned by
[`7oas7er/platform`](https://github.com/7oas7er/platform) `shared-obs`. This root only
sets `cloudflare_zone_tag` so the dashboard zone variable matches `7oas7er.com`.

Probe script (optional) still lives under `scripts/` here, or use platform
`shared-obs/scripts/probe-cloudflare-graphql.sh`.

### GitHub Actions CI

1. Create a fine-grained PAT for repo `7oas7er/dressme` with **Actions: Read**, **Metadata: Read**, and **Contents: Read** if the plugin requires it.
2. Set `github_access_token` in `terraform.tfvars` (or `GITHUB_GRAFANA_TOKEN`).
3. The `grafana-github-datasource` **plugin** is installed by platform `shared-obs`. This root only creates DS `github-dressme`.
4. Both env dashboards include GitHub panels for `deploy-dressme.yml` and `terraform-plan.yml`.
   Panel targets must put the file name in `options.workflow` (not a top-level `workflow`
   field) — otherwise the plugin queries an empty name and returns `workflow not found`.

Without the GitHub token, synthetics + CloudWatch still apply; the GitHub DS is skipped.

## Dashboards

Platform template (structure / windows / Free limits / new-app checklist):
[`docs/grafana-dashboard-template.md`](../../../docs/grafana-dashboard-template.md).

| Dashboard | Host / CloudFront `Name` tag |
|-----------|------------------------------|
| DressMe — Production | `dressme.7oas7er.com` / `prod-dressme-site-distribution` |
| DressMe — Staging | `dressme-stg.7oas7er.com` / `stg-dressme-site-distribution` |

Top rows use **fixed relative ranges** (hour / day / week / month / year):

- **Requests / 4xx+5xx** — Cloudflare GraphQL Adaptive for ≤30d windows; **year uses CloudWatch** (Free Adaptive max span ≈ 4w2d)
- **Latency** — CloudFront `OriginLatency` + Cloudflare `avg.originResponseDurationMs` (Free does **not** expose edge TTFB)
- Month window is `now-30d` with hourly buckets (`datetimeDay_ASC` is not a valid Adaptive orderBy)

Below that: synthetics (env-scoped site + `/api/health`); Cloudflare volume / cache & bots / paths & firewall; GitHub CI. CloudWatch scrape remains for year-window / OriginLatency series only (no dedicated CloudWatch dashboard section).

Infinity GraphQL panels must put the query in `url_options.body_graphql_query` (or `url_options.data`). A top-level `data` field is ignored by the backend parser, so Cloudflare gets an empty query, returns `null`, and Infinity surfaces a misleading “JSONata / paths” frame error.

Regenerate JSON after layout edits:

```bash
python3 infra/terraform/grafana/scripts/generate-env-dashboards.py
```

CloudWatch scrape includes `OriginLatency` (Average). After changing `cloudwatch.tf`, `terraform apply` this root so Grafana re-exports the metric before latency panels fill in.

## Apply

```bash
cd infra/terraform/grafana
cp terraform.tfvars.example terraform.tfvars   # first time
terraform init
terraform plan
terraform apply
```

AWS profile: `7oas7er`. Tokens may also be supplied via `GRAFANA_*` env vars where the provider supports them.

## Notes

- Set `enable_cloudwatch_scrape = false` in `terraform.tfvars` to remove the Cloud Provider AWS account + scrape job without deleting the IAM role.
- Set `enable_cloudflare_edge = false` to skip Cloudflare zoneTag dashboard wiring; `enable_github_ci = false` skips DS `github-dressme`.
- CloudWatch scrape covers `eu-north-1` and `us-east-1` (CloudFront metrics).
- Tagged AWS resources (`Name` tags on DressMe) improve metric discovery.
- Metrics-only for now — no CloudWatch Logs shipping into Grafana.
