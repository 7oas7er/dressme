---
name: gap-against-app-template
description: >-
  Compares the current repo to the DressMe / app-* solo+AI template (isolated
  app repo + 7oas7er/platform shared-edge/shared-obs, one AWS account,
  Grafana-first, Terraform SoT, staging→main). Use when the user asks for a gap
  analysis, template compliance check, migrate-to-template plan, or how an
  existing project differs from DressMe / the app template.
---

# Gap against app template

Compare **this workspace** to the canonical template (DressMe / `app-*` pattern + [`7oas7er/platform`](https://github.com/7oas7er/platform)). Produce gaps + a staged migration plan. Do **not** apply infra or rewrite the app unless Frank explicitly asks.

## Locate the template

1. Prefer a path or GitHub URL Frank gives in the message.
2. Else try sibling / known checkout: `…/devel/Cursor` or repo `7oas7er/dressme`; platform at `…/devel/platform` or `7oas7er/platform`.
3. If the template is not readable, ask once for the path or to add it to the workspace — then stop guessing.

Read from the template (when available): `docs/architecture.md`, `.cursor/rules/README.md`, `app-core` / `app-observability` / `app-terraform` / `app-deploy`, `docs/adr/` (esp. 0007), `docs/maintenance.md`, `AGENTS.md`, `SECURITY.md`, skill `new-app-from-template`. Also platform `docs/architecture.md` / ADR 0001.

## Rubric (score each: aligned / partial / missing / N/A)

| Area | Template expectation |
|------|----------------------|
| **Repo isolation** | Own app repo; depends on `7oas7er/platform` (or equivalent) for zone rulesets + shared Infinity/plugin; **not** on sibling apps |
| **Delivery** | Static or minimal frontend as product requires; no drive-by SPA/bundler unless product needs it |
| **IaC** | Terraform SoT; no CDK/CloudFormation app stacks; separate roots (aws envs, cloudflare DNS, grafana app, bootstrap) |
| **Apply model** | CI plan-only; local apply; no default CI apply |
| **Envs** | `staging` → AWS stg; `main` → AWS prod; distinct GitHub Environments |
| **Edge** | App Cloudflare = DNS only; zone rulesets in platform; Cloudflare-only origin |
| **Observability** | Grafana-first only; Infinity + GitHub plugin in platform; no second APM SaaS; **two** env dashboards per [`docs/grafana-dashboard-template.md`](../../../docs/grafana-dashboard-template.md) |
| **Regions** | `eu-north-1` default; `us-east-1` only when required (e.g. ACM for CloudFront) |
| **CI gates** | Tests gate deploy; terraform fmt/validate/plan; Checkov or equivalent; npm audit high+; CodeQL or equivalent SAST |
| **Supply chain** | Dependabot (or Renovate) → staging; Actions + app deps + Terraform providers; **all** workflow Actions SHA-pinned (`docs/github-actions-pinning.md` + Required CI pin check) |
| **GitHub security floor** | Default branch `main`; Dependabot **alerts** on; secret scanning + push protection on; ruleset on `main`/`staging` (`Required CI`); Actions `GITHUB_TOKEN` read-only (no PR approve); CodeQL default setup off. **Verify via GitHub API** — do not score from docs alone (`docs/github-branch-protection.md`) |
| **Docs / agents** | `AGENTS.md`, architecture doc, ADRs for irreversible choices, `SECURITY.md`, Cursor `app-*` rules |
| **Maintenance** | Documented weekly/monthly cadence |
| **Secrets** | No committed tfvars/state/tokens; OIDC for AWS in Actions |

Mark **N/A** when the product legitimately differs (e.g. not a public web app) — say why.

## Output format

1. **Context** — one paragraph: what this repo is; template path used.
2. **Gap table** — Area | Status | Evidence (paths) | Notes.
3. **Migration plan** — ordered PRs/steps, smallest first (docs/rules → **GitHub security floor via `gh`** → CI → Terraform layout → edge gate → Grafana). Call out blast radius and “apply locally” where needed. Security Settings gaps are **P0** even when in-repo workflows already exist.
4. **Non-goals** — what not to copy from DressMe (game-specific `dressme-*`, `/api/health`, puzzle UX).
5. **Ask** — only if blocked (missing template access, ambiguous prod risk).

## Rules of engagement

- Prefer **gap report + plan** over drive-by refactors.
- Reuse template wording from ADRs; don’t invent a second monitoring stack or CI apply “to catch up.”
- For greenfield from the template, point Frank at **`new-app-from-template`** instead of this skill.
- After Frank approves a slice, implement in small PRs to `staging` (or that repo’s equivalent).

## Example triggers

- “Gap-analyze this repo against DressMe.”
- “What would it take to migrate X to the app template?”
- “Template compliance check vs `7oas7er/dressme`.”
