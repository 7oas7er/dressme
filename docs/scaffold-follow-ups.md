# DressMe scaffold — operator follow-ups

Scaffold creates the isolated app repo. These steps are **not** done by the first PR alone.

## Platform (`7oas7er/platform`)

- [ ] `shared-edge`: origin-verify secrets for `dressme.7oas7er.com` and `dressme-stg.7oas7er.com`
- [ ] `shared-edge`: extend transform / cache host rules for those hostnames
- [ ] Apply `shared-edge` **before** relying on the CloudFront origin-verify gate
- [ ] Confirm shared Infinity + GitHub plugin still from `shared-obs` (do not recreate in this app)

## Local Terraform (`AWS_PROFILE=7oas7er`)

- [ ] `infra/terraform/aws/bootstrap` (state bucket `shared-dressme-terraform-state-bucket`)
- [ ] Fresh gitignored `terraform.tfvars` per root (never copy Block Drop secrets)
- [ ] `aws/envs/stg` (ACM cert in `us-east-1`, origin-verify secret, OIDC subjects)
- [ ] Prefer immutable OIDC subjects: `repo:7oas7er@2952810/dressme@<repo_database_id>:environment:…`
- [ ] Cloudflare DNS root (app hosts only)
- [ ] Grafana app root (folder, dual dashboards, synthetics, CW scrape, GitHub DS)
- [ ] `aws/envs/prod` after stg is proven

## GitHub

- [ ] Environments `staging`, `production`, `terraform` with distinct roles/buckets/hosts
- [ ] Security floor API-verified (`docs/github-branch-protection.md`)
- [ ] Cursor GitHub App installed on this repo (for cloud agents)

## Product (next tasks)

- [ ] Cognito + DynamoDB + S3 media + suggest (UC-01–06) — out of scaffold scope
