# DressMe scaffold — operator follow-ups

Scaffold creates the isolated app repo. These steps are **not** done by the first PR alone.

## Platform (`7oas7er/platform`)

- [x] `shared-edge`: origin-verify secrets for `dressme.7oas7er.com` and `dressme-stg.7oas7er.com`
- [x] `shared-edge`: extend transform / cache host rules for those hostnames
- [x] Apply `shared-edge` **before** relying on the CloudFront origin-verify gate
- [x] Confirm shared Infinity + GitHub plugin still from `shared-obs` (do not recreate in this app)

## Local Terraform (`AWS_PROFILE=7oas7er`)

- [x] `infra/terraform/aws/bootstrap` (state bucket `shared-dressme-terraform-state-bucket`) — local backend (like Netrunner)
- [x] Fresh gitignored `terraform.tfvars` per root (never copy Block Drop secrets)
- [x] `aws/envs/stg` (ACM cert in `us-east-1`, origin-verify secret, OIDC subjects)
- [x] Prefer immutable OIDC subjects: `repo:7oas7er@2952810/dressme@1433682888:environment:…` (repo id confirmed)
- [x] Cloudflare DNS root (stg host; prod CNAME deferred until prod AWS apply)
- [x] Grafana app root (folder, dual dashboards, synthetics, CW scrape; GitHub DS deferred — `enable_github_ci = false` until PAT)
- [ ] `aws/envs/prod` after stg is proven

## GitHub

- [x] Environments `staging`, `production`, `terraform` created (wire distinct roles/buckets/hosts after local Terraform)
- [x] Staging Environment vars wired from stg Terraform outputs (`AWS_DEPLOY_ROLE_ARN`, bucket, distribution, `SITE_HOST`, `CLOUDFLARE_ZONE_ID`)
- [x] Terraform Environment plan role + `CLOUDFLARE_API_TOKEN` / origin-verify secrets for plan CI
- [x] Ruleset `default` active on `main`+`staging` (`Required CI` only; no force-push/delete; PR required)
- [x] Issues / Wiki / Projects off
- [ ] Dependabot alerts + secret scanning + push protection — confirm in Settings (this App token lacks `administration=read`, cannot API-verify)
- [ ] Actions `GITHUB_TOKEN` read-only + cannot approve PRs — same (UI confirm)
- [ ] CodeQL **default** setup off — same (in-repo advanced workflow only)
- [x] Cursor GitHub App installed on this repo (for cloud agents) — Contents R/W verified 2026-10-25; Administration still Read
- [ ] Production Environment vars after prod apply
- [ ] Grafana `github_access_token` / `enable_github_ci = true` for CI panels

## Verify (stg)

- [x] `https://dressme-stg.7oas7er.com` → 200 (seeded static placeholder)
- [x] Raw CloudFront URL → 403 (origin-verify)

## Product (next tasks)

- [x] Cognito + DynamoDB + S3 media + catalog CRUD (UC-01–03)
- [x] Manage photos while editing an item (UC-18)
- [ ] Suggest + collage + Bedrock (UC-04–06)
