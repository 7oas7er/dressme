# DressMe

Personal wardrobe catalog and outfit suggestions (classic menswear), plus the **app-owned** AWS / DNS / Grafana stack. Bootstrapped from the Block Drop solo+AI template.

**Fundamental design:** each app is an **isolated repository**. Shared Cloudflare zone rulesets and shared Grafana Free objects (Infinity DS, GitHub plugin) live in [`7oas7er/platform`](https://github.com/7oas7er/platform). Apps depend on platform — **never on each other**. Architecture: [`docs/architecture.md`](docs/architecture.md) (Option A).

Frontend source lives under [`web/`](web/) (Vite); build output under [`dressme/`](dressme/). Product scope: UC-01–06 (catalog first).

## Layout

| Path | Role |
|------|------|
| [`web/`](web/) | Vite SPA source (catalog + Cognito gate) |
| [`dressme/`](dressme/) | Built site assets synced to S3 |
| [`tests/`](tests/) | Node unit tests + Playwright e2e; gates deploy |
| [`infra/terraform/aws/`](infra/terraform/aws/) | Site module + `envs/stg` / `envs/prod` + bootstrap |
| [`infra/terraform/cloudflare/`](infra/terraform/cloudflare/) | **DNS only** for DressMe hosts (zone rulesets → platform `shared-edge`) |
| [`infra/terraform/grafana/`](infra/terraform/grafana/) | App synthetics, CloudWatch, **prod+stg** dashboards, GitHub DS |
| [`infra/lambda/`](infra/lambda/) | API Lambda (`/api/health`, `/api/config`, `/api/items*`) |
| [`.cursor/rules/`](.cursor/rules/) | Platform (`app-*`) + product (`dressme-*`) |
| [`AGENTS.md`](AGENTS.md) | Definition of done for AI-assisted changes |
| [`docs/architecture.md`](docs/architecture.md) | App vs platform ownership + Option A |
| [`SECURITY.md`](SECURITY.md) | Reporting + secret leak / rotation pointers |

## Domains

| Env | Host |
|-----|------|
| staging | `dressme-stg.7oas7er.com` |
| production | `dressme.7oas7er.com` |

## Environments and promotion

- Feature work → PR into **`staging`** → deploys **AWS stg** only.
- Promote to production by merging **`staging` → `main`** → deploys **AWS prod**.
- GitHub Environments `staging` / `production` / `terraform` hold distinct roles and resources.

## CI / CD

| Workflow | What it does |
|----------|----------------|
| [`.github/workflows/deploy-dressme.yml`](.github/workflows/deploy-dressme.yml) | Unit + Playwright; on push to `staging`/`main`, syncs `dressme/` to S3, invalidates CloudFront, purges Cloudflare |
| [`.github/workflows/terraform-plan.yml`](.github/workflows/terraform-plan.yml) | `fmt` / Checkov / `validate` / **plan** (never apply) |
| [`.github/workflows/dependency-audit.yml`](.github/workflows/dependency-audit.yml) | `npm audit --audit-level=high` for `tests/` and `infra/lambda/` |
| [`.github/workflows/required-ci.yml`](.github/workflows/required-ci.yml) | Always-on PR check (`Required CI`) |
| [`.github/workflows/codeql.yml`](.github/workflows/codeql.yml) | CodeQL for `dressme/`, `infra/lambda/`, Actions |

## Terraform (local apply)

```bash
export AWS_PROFILE=7oas7er
```

Order: bootstrap → `aws/envs/stg` → platform `shared-edge` (DressMe hosts) → Cloudflare DNS → Grafana → prod when ready.

Never commit `.tfstate`, `terraform.tfvars`, API tokens, or AWS keys.

## Observability

**Grafana Cloud Free** only. Dual dashboards: DressMe — Production / Staging. Shared Infinity + GitHub plugin from platform `shared-obs`.

## Security floor

Apply and API-verify per [`docs/github-branch-protection.md`](docs/github-branch-protection.md) (Dependabot alerts, secret scanning + push protection, ruleset on `main`/`staging`, read-only `GITHUB_TOKEN`, CodeQL default off).
