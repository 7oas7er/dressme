---
name: new-app-from-template
description: >-
  Bootstraps a new solo+AI public web app from the DressMe template pattern
  (isolated app repo + 7oas7er/platform shared-edge/shared-obs, AWS one account,
  Cloudflare DNS-only in-app, Grafana-first, Terraform SoT). Use when cloning
  this repo, starting a new app from the template, renaming project slugs, or
  walking first apply / first PR / promote-to-main.
---

# New app from template

Source pattern: this repo (`dressme` + `app-*` Cursor rules) **plus** [`7oas7er/platform`](https://github.com/7oas7er/platform). Read `docs/architecture.md` and `.cursor/rules/README.md` first.

**Fundamental:** the new app is its **own repository**. It must depend on platform for zone rulesets and shared Infinity/GitHub plugin — **not** on DressMe or any sibling app.

For an **existing** app that was not cloned from this template, use **`gap-against-app-template`** instead (gap table + migration plan).

## Preconditions

- One AWS account, profile `7oas7er` (or update docs/rules to the new profile).
- Access to Cloudflare zone `7oas7er.com` via platform `shared-edge` (or your zone’s platform root).
- Grafana Cloud Free stack already wired in platform `shared-obs`.
- GitHub repo (new **or** existing/migrated) with Environments `staging`, `production`, `terraform`.

## Checklist (copy and tick)

```
New app progress:
- [ ] 1. Copy / clone layout (new isolated app repo)
- [ ] 2. Rename product (paths, slug, domains)
- [ ] 3. Cursor rules (keep app-*, replace product overlays)
- [ ] 4. Terraform state keys + resource names + Project tags
- [ ] 5. Platform shared-edge: origin-verify (+ cache hosts) for new domains
- [ ] 6. Grafana labels / folder / dashboard (no Infinity / no GitHub plugin)
- [ ] 7. GitHub Environments + OIDC subjects
- [ ] 7b. GitHub security floor (apply + API-verify — see docs/github-branch-protection.md)
- [ ] 8. First local applies (bootstrap → stg → cloudflare DNS → grafana; platform edge secrets)
- [ ] 9. First PR → staging
- [ ] 10. First promote staging → main
```

### 1. Copy layout

Keep: `infra/terraform/{aws,cloudflare,grafana}/`, `infra/lambda/` (or replace with your API), `.github/workflows/`, `tests/`, `docs/adr/`, `AGENTS.md`, `SECURITY.md`, `app-*` rules, `docs/architecture.md` (retarget to your app).

Replace or empty: product static tree (`dressme/` → your app dir), product dashboard JSON, product-specific ADRs if wrong.

Do **not** copy zone rulesets or Infinity resources into the new app — those stay in platform.

### 2. Rename product

Pick an **app slug** (e.g. `my-app`) and domains.

- Rename static dir; update deploy workflow paths and Dependabot directories.
- Search-replace Terraform locals / names: `dressme` → slug; update state bucket name if creating fresh state.
- Domains in Cloudflare + ACM + GitHub `SITE_HOST`.
- Update `README.md`, `AGENTS.md`, product Cursor rules, Grafana `project=` label.

### 3. Cursor rules

- **Keep** all `app-*.mdc`.
- **Replace** `dressme-*.mdc` with `<slug>-*.mdc` (or one thin `product-core` + frontend/terraform overlays).
- Update `.cursor/rules/README.md` table.
- Do not leave conflicting alwaysApply rules that restate opposite platform choices.

### 4. Terraform state

- New state bucket **or** new key prefixes under an existing bucket (never reuse another app’s `envs/prod/` key).
- Keys typically: `bootstrap/`, `envs/stg/`, `envs/prod/`, `cloudflare/`, `grafana/`.
- Fresh `terraform.tfvars` (gitignored) per root; never copy prod secrets from another app.

### 5. Platform `shared-edge`

In [`7oas7er/platform`](https://github.com/7oas7er/platform):

- Add origin-verify secrets for stg/prod hosts (tfvars + variables).
- Extend transform / cache host rules for the new hostnames.
- Apply `shared-edge` **before** enabling the CloudFront Function gate in the app AWS root.

### 6. Grafana (app root only)

Follow [`docs/grafana-dashboard-template.md`](../../../docs/grafana-dashboard-template.md) (same layout as DressMe / Netrunner):

- New folder; **two** dashboards — `<Product> — Production` and `<Product> — Staging` (not one mixed overview).
- Copy/adapt `infra/terraform/grafana/scripts/generate-env-dashboards.py` → emit `<slug>-prod.json` / `<slug>-stg.json`; wire `for_each` in `dashboard.tf`. Parameterize hosts, probe jobs, CloudFront `Name` tags, GitHub DS uid, workflow file names, `project=<slug>` PromQL labels.
- Synthetics for site + critical API paths (labels `project`, `environment`, `kind`).
- CloudWatch scrape includes CloudFront **OriginLatency**; regions `eu-north-1` + `us-east-1` when CloudFront is used.
- New stack service account name if publishing via Terraform.
- Set `cloudflare_zone_tag`; use shared Infinity uid from platform — **do not** create Infinity or install the GitHub plugin.
- Create per-app GitHub DS only (plugin already installed by `shared-obs`); CI panels use `options.workflow` = workflow file name.

### 7. GitHub Environments

| Environment | Points at |
|-------------|-----------|
| `staging` | stg deploy role, stg bucket/distribution/host/zone |
| `production` | prod deploy role, prod bucket/distribution/host/zone |
| `terraform` | plan role + plan-time vars/secrets |

OIDC trust subjects must match `environment:…`. Distinct resources per env — see `docs/adr/0006-github-env-separation.md`.

### 7a. GitHub Actions SHA pins (mandatory)

- Every workflow `uses:` must be `owner/action@<40-char-sha> # vX.Y.Z` (GitHub-owned and third-party). See `docs/github-actions-pinning.md`.
- Keep `.github/scripts/check-github-action-pins.sh` and the **Require SHA-pinned Actions** step in Required CI.
- Dependabot `package-ecosystem: github-actions` → `staging` so SHAs stay current.

### 7b. GitHub security floor (mandatory — new **and** migrated repos)

Repo Settings are **not** copied with git. Old public repos often lack create-time defaults that DressMe got in 2026. **Always** apply and verify against `docs/github-branch-protection.md`:

1. Default branch = **`main`** (template tree + `SECURITY.md`).
2. Enable **Dependabot alerts** (`PUT …/vulnerability-alerts`).
3. Enable **secret scanning** + **push protection**.
4. Create/update ruleset `default` on `main` + `staging` (PR required, no force-push/delete, required check **`Required CI`** only).
5. Actions workflow permissions: `GITHUB_TOKEN` **read**, cannot approve PRs.
6. CodeQL **default** setup stays **off** (in-repo advanced workflow only).
7. Prefer Issues/Wiki/Projects **off** for static apps.

**Verify via `gh api` before checking this box.** Do not copy DressMe checklist text that says controls “were already on.”

### 8. First local applies

Order (adjust if bootstrap already exists):

```bash
export AWS_PROFILE=7oas7er
# 1) bootstrap (state bucket) if new
# 2) aws/envs/stg  (site + OIDC + plan role)
# 3) platform shared-edge secrets for new hosts (if not done in step 5)
# 4) cloudflare    (DNS only for this app’s hosts)
# 5) grafana       (synthetics/dashboard; may need stg URLs)
# 6) aws/envs/prod after stg is proven
```

Confirm Cloudflare-only gate (raw CloudFront URL 403; custom domain 200).

### 9. First PR → staging

- Branch from `staging`; small first PR (docs or no-op path under app dir).
- Require green: `Required CI`, tests if site paths change, terraform plan/Checkov if infra changes.
- Merge; confirm stg deploy + synthetics.

### 10. First promote → main

- Open PR `staging` → `main` only when stg is healthy.
- After merge: prod deploy; local `terraform apply` for prod roots if infra differed; confirm prod synthetics.

## Anti-patterns

- Pointing `staging` and `production` GitHub Environments at the same role/bucket.
- Adding a second monitoring SaaS or CI `terraform apply` without a new ADR.
- Shipping a single Grafana “overview” dashboard instead of the dual-env template in `docs/grafana-dashboard-template.md`.
- Leaving GitHub Actions on mutable tags (`@v4`, `@v7.0.1`) — pin to full SHAs (`docs/github-actions-pinning.md`).
- Copying `terraform.tfvars` or state between apps.
- Recreating zone rulesets / Infinity / GitHub plugin inside the new app.
- Making the new app depend on DressMe (or any sibling) for edge/obs.
- Leaving `dressme-*` alwaysApply rules that contradict the new product.
- Shipping workflows/docs while leaving Code security / rulesets / default branch at legacy defaults (especially on **migrated** repos).
- Marking secret scanning / Dependabot alerts “done” without an API verify against the target repo.

## References

- `docs/architecture.md`, platform `docs/architecture.md`
- `.cursor/rules/README.md`
- `docs/adr/` (especially 0003 local apply, 0005 Cloudflare-only, 0006 env separation, 0007 platform)
- `SECURITY.md`, `docs/github-branch-protection.md`, `infra/terraform/docs/origin-verify-secret-rotation.md`
- `docs/template-readiness-backlog.md`
