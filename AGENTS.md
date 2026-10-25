# Agent definition of done — DressMe

Instructions for Cursor (and similar) agents working in this repo. Platform rules: [`app-core.mdc`](.cursor/rules/app-core.mdc) (see [`.cursor/rules/README.md`](.cursor/rules/README.md)). Product overlay: [`dressme-core.mdc`](.cursor/rules/dressme-core.mdc). Architecture: [`docs/architecture.md`](docs/architecture.md). Decisions: [`docs/adr/`](docs/adr/). Secrets: [`SECURITY.md`](SECURITY.md). Cloning a new app: [`.cursor/skills/new-app-from-template/`](.cursor/skills/new-app-from-template/). Gap analysis / migrate an existing repo toward this pattern: [`.cursor/skills/gap-against-app-template/`](.cursor/skills/gap-against-app-template/).

## Defaults

- Prefer **small diffs** that match existing patterns. No drive-by refactors outside the task.
- DressMe frontend lives under `dressme/` (SPA; small bundler OK). Tests under `tests/` gate deploy. v1 = UC-01–06 only (Option A).
- **Repo isolation**: this app must not become a dependency of sibling apps. Shared edge/obs → [`7oas7er/platform`](https://github.com/7oas7er/platform) (`app → platform` only).
- **Terraform** is the source of truth for AWS / Cloudflare DNS / Grafana app objects. Do not reintroduce CDK or manage app resources with CloudFormation.
- **Observability**: Grafana Cloud only. Do not add Checkly, Datadog, New Relic, or similar unless Frank explicitly asks to replace Grafana. Shared Infinity DS + GitHub plugin: [`7oas7er/platform`](https://github.com/7oas7er/platform) `shared-obs`. Dual env dashboards per [`docs/grafana-dashboard-template.md`](docs/grafana-dashboard-template.md).
- **Cloudflare** app root is DNS only; zone rulesets live in platform `shared-edge`. Do not turn Cloudflare into a second monitoring product or default Workers platform for this app.
- Public apps must **only accept Cloudflare-fronted traffic**; reject direct origin access.

## GitHub workflow

- Feature work: branch → PR → **`staging`** (deploys AWS stg when site paths change).
- Production: PR **`staging` → `main`** only when asked to promote.
- Do **not** push or merge unless Frank asks. Do **not** force-push protected branches.
- Create commits only when asked; follow the repo’s commit / PR conventions.
- **Security floor** (Dependabot alerts, secret scanning + push protection, ruleset, default branch `main`, read-only `GITHUB_TOKEN`): apply and API-verify per [`docs/github-branch-protection.md`](docs/github-branch-protection.md) on every new or migrated app — copying this repo’s files is not enough.
- **Actions pins**: every workflow `uses:` is a full 40-char SHA with a version comment ([`docs/github-actions-pinning.md`](docs/github-actions-pinning.md)); do not reintroduce mutable `@v…` tags. Required CI enforces the pin script.

## Terraform

- CI runs **fmt / validate / plan** only (see `.github/workflows/terraform-plan.yml`). **Never** add or run `terraform apply` in GitHub Actions unless Frank explicitly requests that change and an ADR supersedes [`docs/adr/0003-local-terraform-apply.md`](docs/adr/0003-local-terraform-apply.md).
- New irreversible platform choice → add a short ADR under [`docs/adr/`](docs/adr/) (see that folder’s README).
- Apply locally with `AWS_PROFILE=7oas7er` when Frank asks.
- Never commit `.tfstate`, `terraform.tfvars`, API tokens, or AWS keys.

## Secrets

- Cloudflare: `CLOUDFLARE_API_TOKEN` / analytics tokens via env or gitignored tfvars.
- Grafana: `GRAFANA_*` or gitignored `infra/terraform/grafana/terraform.tfvars`.
- GitHub deploy/plan: Environment secrets and vars; OIDC for AWS — no long-lived access keys in GitHub.

## Definition of done (checklist)

Before considering a task finished:

1. [ ] Change matches the request; no unrelated refactors.
2. [ ] Follows `.cursor/rules` for the area touched (`app-*` platform + `dressme-*` product overlays).
3. [ ] No secrets or state files staged.
4. [ ] If `dressme/` or `tests/` changed: note or run relevant tests (`cd tests && npm test` when practical).
5. [ ] If Terraform changed: roots identified; remind Frank to `terraform plan` / `apply` locally; CI plan + Checkov will run on the PR when paths match. New Checkov skips need a one-line justification (`docs/iac-policy.md`). Security header / CSP changes need stg apply first (`docs/security-headers.md`).
6. [ ] If `tests/` or `infra/lambda/` lockfiles changed: `npm audit --audit-level=high` must stay clean (CI workflow `dependency-audit.yml`).
7. [ ] If `dressme/` or `infra/lambda/` JS changed: expect CodeQL on the PR (`docs/codeql.md`); fix real findings, don’t blanket-suppress.
8. [ ] If asked for a PR: target **`staging`** unless Frank asked for a promote-to-`main` PR.
9. [ ] Docs updated when behavior or operator steps change (README, runbooks under `infra/terraform/docs/`, or this file). Optional: `pre-commit install` locally (`.pre-commit-config.yaml`).

## Explicit non-goals (unless Frank overrides in writing)

- Full UC-01–06 / Cognito / Bedrock in a “docs-only” change
- Second monitoring SaaS
- CI `terraform apply` by default
- Committing credentials “temporarily”
- App → app dependency on Block Drop or Netrunner
