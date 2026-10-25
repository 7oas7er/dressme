# Cursor rules — platform vs product

Rules split so this repo can be cloned as a **solo + AI** template without fighting product names forever.

**Naming note:** Cursor `app-*` rules are the **in-repo platform pattern** (hosting, Grafana, Terraform habits). The **GitHub platform repository** [`7oas7er/platform`](https://github.com/7oas7er/platform) is separate: shared-edge + shared-obs that all apps consume. Do not conflate the two.

| Kind | Prefix | Role |
|------|--------|------|
| **App pattern** | `app-*` | Public web app in **one AWS account**, DNS-only Cloudflare in-app, Grafana-first, Terraform SoT; depends on `7oas7er/platform` for zone rulesets + shared Infinity/plugin |
| **Product** | `dressme-*` | DressMe wardrobe app (`dressme/`, domains, Option A stack) |

When cloning for a new app: keep `app-*`, replace or delete `dressme-*`, wire secrets/hosts into [`7oas7er/platform`](https://github.com/7oas7er/platform), and follow the skill `.cursor/skills/new-app-from-template/`.

When **gap-analyzing or migrating** an existing repo toward this pattern: `.cursor/skills/gap-against-app-template/` (also in personal Agent Store). Architecture: [`docs/architecture.md`](../../docs/architecture.md).

## Files

| Rule | Scope |
|------|--------|
| `app-core.mdc` | always — hosting, envs, secrets, Cloudflare-only, agents |
| `app-aws-regions.mdc` | always — `eu-north-1` default |
| `app-observability.mdc` | always — Grafana pattern (dual-env dashboards: [`docs/grafana-dashboard-template.md`](../../docs/grafana-dashboard-template.md)) |
| `app-terraform.mdc` | `infra/terraform/**` — roots, state, CI plan |
| `app-deploy.mdc` | `.github/workflows/**` — OIDC deploy / promote; Action SHA pins |
| `dressme-core.mdc` | always — product + pointers to platform |
| `dressme-frontend.mdc` | `dressme/**` |
| `dressme-terraform.mdc` | `infra/terraform/**` — naming, domains, API |
| `dressme-deploy.mdc` | `.github/workflows/**` — this app’s workflow |
| `dressme-observability.mdc` | always — this app’s labels / dashboard path |
