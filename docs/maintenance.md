# Ongoing maintenance

Solo + AI cadence for this template. Automation discovers updates; you merge when green and apply Terraform locally.

## Automation (already on)

| Source | What | Target |
|--------|------|--------|
| [Dependabot](../.github/dependabot.yml) | GitHub Actions (SHA pins), `tests/` npm, `infra/lambda` npm, **Terraform providers** (per root lockfile) | Weekly PRs → `staging` |
| CI | Tests, Checkov, npm audit (high+), CodeQL, terraform plan, **Action SHA-pin check** | Gates merges |
| Grafana | Synthetics + error views | Catches runtime/edge regressions |

CI **never** runs `terraform apply` ([ADR 0003](adr/0003-local-terraform-apply.md)).

## Weekly (~15–30 min)

```text
[ ] Open Dependabot PRs on staging — merge when CI is green
[ ] Clear or explicitly waive high/critical Dependabot / code-scanning alerts
[ ] Glance Grafana synthetics (stg + prod) and obvious error panels
[ ] Wardrobe cold backup (stg + prod once backup buckets exist):
      ./scripts/wardrobe-backup.sh --env stg && ./scripts/wardrobe-backup.sh --env prod
      (see docs/runbook.md — Backup and restore)
```

One red Dependabot PR: fix or split; don’t batch-merge majors with unknowns.

## Monthly (~1 hour)

```text
[ ] Patch management — survey libs/frameworks/Terraform CLI+providers/AWS engines; prefer open Dependabot PRs
[ ] Documentation accuracy — README/AGENTS/architecture/ADRs/maintenance vs code+Settings reality
[ ] Terraform providers: review Dependabot PRs (or `terraform init -upgrade` per root),
    plan stg → apply stg → plan/apply prod when ready
[ ] Terraform CLI: if CI pin in terraform-plan.yml drifted from local, bump both;
    keep required_version floors in versions.tf coherent
[ ] AWS Project= tag audit (eu-north-1; us-east-1 for CloudFront/ACM/Billing)
[ ] GitHub security floor API verify (docs/github-branch-protection.md)
[ ] pre-commit autoupdate (then commit the config change via a normal PR)
[ ] npm audit high+ clean where lockfiles exist (tests/, infra/lambda/)
[ ] Secrets: rotate only if leak / offboarding / vendor forced expiry (see SECURITY.md)
```

Roots with lockfiles: `infra/terraform/aws/bootstrap`, `aws/envs/stg`, `aws/envs/prod`, `cloudflare`, `grafana`.

## After any infra merge

```text
[ ] Local apply when the plan showed real changes
[ ] Custom domain still 200; raw CloudFront URL still 403 (origin-verify)
```

## Cognito owner stuck / no reset email (stg)

Terraform creates the owner with a **temporary** password (`FORCE_CHANGE_PASSWORD`). Hosted UI “Forgot password?” is unreliable until the user is `CONFIRMED`: the SPA client has `prevent_user_existence_errors`, and Cognito’s default mailer (`COGNITO_DEFAULT` → `no-reply@verificationemail.com`, 50/day) often never lands.

**Unblock without email** (sets a permanent password → `CONFIRMED`):

```bash
export AWS_PROFILE=7oas7er AWS_DEFAULT_REGION=eu-north-1
POOL=$(cd infra/terraform/aws/envs/stg && terraform output -raw cognito_user_pool_id)
# Generate a 12+ char password yourself (upper/lower/number/symbol); do not paste into chat.
aws cognito-idp admin-set-user-password \
  --user-pool-id "$POOL" \
  --username frank@schlesinger.com \
  --password 'YOUR_NEW_PASSWORD' \
  --permanent
```

Then sign in at https://dressme-stg.7oas7er.com/ with that password (email all lowercase). Optional first-login path while still `FORCE_CHANGE_PASSWORD`: Hosted UI + `terraform output -raw cognito_owner_temporary_password` → set a new permanent password there.

## Quarterly (optional)

- Terraform / Node / Playwright **major** upgrades when pain or support ends
- Re-read [template-readiness-backlog.md](template-readiness-backlog.md) P2.3 / P3 — only if needed
- Confirm branch ruleset + CodeQL advanced setup + secret scanning / Dependabot alerts still as documented (`docs/github-branch-protection.md` verify commands)

## Template reuse

- New app from this repo: skill `new-app-from-template`
- Existing app gap / migrate: skill `gap-against-app-template`

## What not to add by default

- Renovate alongside Dependabot
- CI apply for routine patches
- A second monitoring or SCA SaaS
