# DressMe

Personal wardrobe catalog and outfit suggestions (classic menswear), plus the **app-owned** AWS / DNS / Grafana stack. Bootstrapped from the Block Drop solo+AI template.

**Fundamental design:** each app is an **isolated repository**. Shared Cloudflare zone rulesets and shared Grafana Free objects (Infinity DS, GitHub plugin) live in [`7oas7er/platform`](https://github.com/7oas7er/platform). Apps depend on platform — **never on each other**.

**Architecture:** [docs/architecture.md](docs/architecture.md) · **Use cases:** [docs/use-cases.md](docs/use-cases.md) · **ADRs:** [docs/adr/](docs/adr/) · **Agents:** [AGENTS.md](AGENTS.md) · **Ops runbook:** [docs/runbook.md](docs/runbook.md) · **Security floor:** [docs/github-branch-protection.md](docs/github-branch-protection.md) · **Secrets:** [SECURITY.md](SECURITY.md) · **Maintenance:** [docs/maintenance.md](docs/maintenance.md)

Frontend source lives under [`web/`](web/) (Vite); build output under [`dressme/`](dressme/). Product scope: UC-01–06 + UC-18–19 (Option A); catalog first.

## Layout

| Path | Role |
|------|------|
| [`web/`](web/) | Vite SPA source (catalog + Cognito gate) |
| [`dressme/`](dressme/) | Built site assets synced to S3 |
| [`tests/`](tests/) | Node unit tests + Playwright e2e; gates deploy |
| [`infra/terraform/aws/`](infra/terraform/aws/) | Site module + `envs/stg` / `envs/prod` + bootstrap |
| [`infra/terraform/cloudflare/`](infra/terraform/cloudflare/) | **DNS only** for DressMe hosts (zone rulesets → platform `shared-edge`) |
| [`infra/terraform/grafana/`](infra/terraform/grafana/) | App synthetics, CloudWatch, **prod+stg** dashboards, GitHub DS (Infinity + plugin → platform `shared-obs`; layout [`docs/grafana-dashboard-template.md`](docs/grafana-dashboard-template.md)) |
| [`infra/lambda/`](infra/lambda/) | API Lambda (`/api/health`, `/api/config`, `/api/items*`) |
| [`.cursor/rules/`](.cursor/rules/) | Platform (`app-*`) + product (`dressme-*`) Cursor rules — see [`.cursor/rules/README.md`](.cursor/rules/README.md) |
| [`.cursor/skills/`](.cursor/skills/) | Project skills (`new-app-from-template`, `gap-against-app-template`) |
| [`AGENTS.md`](AGENTS.md) | Definition of done for AI-assisted changes |
| [`docs/architecture.md`](docs/architecture.md) | App vs shared-platform ownership + Option A |
| [`docs/`](docs/) | Use cases, ADRs, cross-cutting docs |
| [`docs/maintenance.md`](docs/maintenance.md) | Ongoing patch / Dependabot cadence |
| [`SECURITY.md`](SECURITY.md) | Reporting + secret leak / rotation pointers |

## Environments and promotion

| Env | Host |
|-----|------|
| staging | `dressme-stg.7oas7er.com` |
| production | `dressme.7oas7er.com` |

- Feature work → PR into **`staging`** → deploys **AWS stg** only.
- Promote to production by merging **`staging` → `main`** → deploys **AWS prod**.
- GitHub Environments `staging` / `production` / `terraform` hold distinct roles and resources. Do not point deploy envs at the same buckets or distributions.

## CI / CD

| Workflow | What it does |
|----------|----------------|
| [`.github/workflows/deploy-dressme.yml`](.github/workflows/deploy-dressme.yml) | Unit + Playwright; on push to `staging`/`main`, syncs `dressme/` to S3, invalidates CloudFront, purges Cloudflare (when site paths change) |
| [`.github/workflows/terraform-plan.yml`](.github/workflows/terraform-plan.yml) | `fmt` / **Checkov** / `validate` / **plan** for changed Terraform roots (OIDC read-only plan role). **Never applies.** |
| [`.github/workflows/dependency-audit.yml`](.github/workflows/dependency-audit.yml) | `npm audit --audit-level=high` for `tests/` and `infra/lambda/` when those lockfiles change |
| [`.github/workflows/required-ci.yml`](.github/workflows/required-ci.yml) | Always-on PR check (`Required CI`) for branch rulesets |
| [`.github/workflows/codeql.yml`](.github/workflows/codeql.yml) | CodeQL SAST for `dressme/`, `infra/lambda/`, and Actions workflows |

Deploy auth is GitHub OIDC → env-specific IAM roles (no long-lived AWS keys in GitHub). Dependabot opens weekly PRs to `staging` for Actions, Playwright/Vite (`tests/` + `web/`), the Lambda AWS SDK, and **Terraform providers** (per root). Ongoing cadence: [`docs/maintenance.md`](docs/maintenance.md). Branch rules: [`docs/github-branch-protection.md`](docs/github-branch-protection.md). Action SHA pins: [`docs/github-actions-pinning.md`](docs/github-actions-pinning.md). Checkov: [`docs/iac-policy.md`](docs/iac-policy.md). CodeQL: [`docs/codeql.md`](docs/codeql.md). Security headers: [`docs/security-headers.md`](docs/security-headers.md).

## Terraform (local apply)

Apply stays on your machine. Typical profile:

```bash
export AWS_PROFILE=7oas7er
```

Roots (separate state keys under the shared state bucket):

- `infra/terraform/aws/bootstrap`
- `infra/terraform/aws/envs/stg` and `envs/prod`
- `infra/terraform/cloudflare` (DNS)
- `infra/terraform/grafana` (app dashboards / synthetics / CW / GitHub DS)

Plus platform roots (separate repo / state): `shared-edge`, `shared-obs` — see [`7oas7er/platform`](https://github.com/7oas7er/platform).

Typical first-apply order: bootstrap → `aws/envs/stg` → platform `shared-edge` (DressMe hosts) → Cloudflare DNS → Grafana → prod when ready.

Never commit `.tfstate`, `terraform.tfvars`, API tokens, or AWS keys. Setup notes:

- [Architecture](docs/architecture.md)
- [Terraform plan CI](infra/terraform/docs/terraform-plan-ci.md)
- [Origin-verify secret rotation](infra/terraform/docs/origin-verify-secret-rotation.md)
- [AWS README](infra/terraform/aws/README.md)
- [Cloudflare README](infra/terraform/cloudflare/README.md)
- [Grafana README](infra/terraform/grafana/README.md)

## Observability

**Grafana Cloud Free** only: synthetics, CloudWatch scrape, Cloudflare edge analytics (via GraphQL into Grafana), GitHub Actions panels. Do not add a second monitoring SaaS. Dual dashboards: DressMe — Production / Staging. Shared Infinity + GitHub plugin: platform `shared-obs`. Cloudflare remains DNS/edge (plus analytics pulled into Grafana)—not an APM product. Dashboard layout: [`docs/grafana-dashboard-template.md`](docs/grafana-dashboard-template.md).

## Security principles

- Public traffic must arrive via **Cloudflare**; direct CloudFront (or other origin) URLs are rejected (origin-verify header gate).
- Secrets live in gitignored tfvars, GitHub Environment secrets, or env vars—not in git.
- GitHub security floor (Dependabot alerts, secret scanning + push protection, ruleset on `main`/`staging`, read-only `GITHUB_TOKEN`, CodeQL default off): apply and API-verify per [`docs/github-branch-protection.md`](docs/github-branch-protection.md).
- Reporting and leak response: [`SECURITY.md`](SECURITY.md). Durable “why” for stack choices: [`docs/adr/`](docs/adr/).

## Local development

**SPA:**

```bash
cd web
npm ci
npm run build
npm run dev   # optional; proxies /api to stg unless DRESSME_API_PROXY is set
```

Details: [`web/README.md`](web/README.md).

**Tests:**

```bash
cd tests
npm ci
npx playwright install chromium
npm test
```

`npm test` builds the SPA first. Details: [`tests/README.md`](tests/README.md).

**Pre-commit** (optional but recommended — catches `terraform fmt` and unit-test regressions before CI):

```bash
pipx install pre-commit   # or: brew install pre-commit
pre-commit install
pre-commit run --all-files
```

Config: [`.pre-commit-config.yaml`](.pre-commit-config.yaml). Hooks run `terraform fmt` under `infra/terraform/` and `npm run test:unit` when `tests/` or `dressme/js/` change. Full `terraform validate` stays in CI (needs init/backends).

## Working with Cursor / agents

Follow [`AGENTS.md`](AGENTS.md) and rules under [`.cursor/rules/`](.cursor/rules/) (`app-*` platform + `dressme-*` product). New app from this pattern: [`.cursor/skills/new-app-from-template/`](.cursor/skills/new-app-from-template/). Gap-analyze / migrate an existing repo: [`.cursor/skills/gap-against-app-template/`](.cursor/skills/gap-against-app-template/). Decisions: [`docs/adr/`](docs/adr/). Product scope: [`docs/use-cases.md`](docs/use-cases.md). Backlog: [`docs/template-readiness-backlog.md`](docs/template-readiness-backlog.md).
