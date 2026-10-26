# GitHub branch protection and security floor

Target branches: **`staging`** and **`main`**. Default branch must be **`main`** (template tree + `SECURITY.md`).

**Hard rule:** copying workflows / docs does **not** configure GitHub. Repo Settings → Code security and rulesets are **out-of-band**. Apply them with `gh` (below) and **verify via API** on every new or migrated app. Never mark this done because a sibling repo already had it, and never trust checklist text copied from DressMe.

## Hard-required check (always runs)

| Check name | Workflow | Why |
|------------|----------|-----|
| `Required CI` | [`.github/workflows/required-ci.yml`](../.github/workflows/required-ci.yml) | Always reports on PRs to `staging`/`main`, so rulesets are not blocked by path filters; also runs the GitHub Actions SHA-pin check ([`docs/github-actions-pinning.md`](github-actions-pinning.md)) |

## Path-filtered checks (enforce when they run)

These **must** pass when GitHub schedules them. Do **not** add them as ruleset-required contexts — a missing check (paths did not match) blocks merge.

| Check name | Workflow | When it runs |
|------------|----------|--------------|
| `App tests` | Deploy DressMe | `dressme/**`, `tests/**`, or that workflow |
| `Format` | Terraform plan | `infra/terraform/**`, `infra/lambda/**`, or that workflow |
| `IaC policy (Checkov)` | Terraform plan | same as Format |
| `npm audit (tests)` | Dependency audit | `tests/package*.json` or that workflow |
| `npm audit (lambda)` | Dependency audit | `infra/lambda/package*.json` or that workflow |
| `Analyze (javascript-typescript)` / `Analyze (actions)` | CodeQL | `dressme/**`, `infra/lambda/**`, workflows, or `.github/codeql/**` |

Also expect Validate / Plan jobs from Terraform plan when infra changes.

**Process:** open **high/critical** Dependabot alerts on `staging`/`main` are merge blockers — resolve or explicitly waive before promoting. Weekly Dependabot PRs already target `staging` (`.github/dependabot.yml`).

## Ruleset settings

One ruleset covering `refs/heads/staging` and `refs/heads/main`:

1. **Restrict deletions** — on  
2. **Block force pushes** — on  
3. **Require a pull request before merging** — on (0 approvals while solo; raise to 1 when a second human joins)  
4. **Require status checks to pass** — on, context **`Required CI`** only (`strict` / up-to-date optional)  
5. **Require signed commits** — on (verified GPG; Frank’s key `413A590799A3CF31AB2C9ECDE27E5FD506790203` / `frank@schlesinger.com`)  

Do **not** require linear history unless you already use squash-only merges.

## Repo security floor (must match DressMe)

| Control | Expected | Notes |
|---------|----------|--------|
| Default branch | **`main`** | Template tree + `SECURITY.md` live here; do not leave an old product branch as default |
| Dependabot **alerts** | **Enabled** | Distinct from Dependabot *security updates* (auto-PRs for vulns) — those stay off unless you choose otherwise |
| Secret scanning | **Enabled** | Public repos may inherit newer-create defaults; **old repos do not** — always enable explicitly |
| Push protection | **Enabled** | Same |
| CodeQL **default** setup | **Off** (`not-configured`) | In-repo advanced setup only (`docs/codeql.md`) |
| Branch ruleset `default` | **Active** on `main` + `staging` (incl. **require signed commits**) | As above |
| Actions `GITHUB_TOKEN` | **Read** | Settings → Actions → General → Workflow permissions |
| Approve PRs with `GITHUB_TOKEN` | **Off** | Same screen |
| Issues / Wiki / Projects | **Off** (template default) | Optional product override; prefer off for static apps |

Leave **off** unless you deliberately opt in: Dependabot security updates, secret-scanning validity checks, non-provider patterns, private vulnerability reporting.

## Apply / verify via `gh` (admin)

Replace `OWNER/REPO` (e.g. `7oas7er/dressme`). Run after Environments exist and `Required CI` has run at least once on `staging`/`main`.

```bash
REPO=OWNER/REPO

# 1) Default branch → main (create/push main first if missing)
gh api -X PATCH "repos/$REPO" -f default_branch=main

# 2) Dependabot alerts
gh api -X PUT "repos/$REPO/vulnerability-alerts"

# 3) Secret scanning + push protection
gh api -X PATCH "repos/$REPO" --input - <<'EOF'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
EOF

# 4) Actions workflow token: read-only, cannot approve PRs
gh api -X PUT "repos/$REPO/actions/permissions/workflow" \
  -f default_workflow_permissions=read \
  -F can_approve_pull_request_reviews=false

# 5) Template hygiene (skip if you need Issues)
gh api -X PATCH "repos/$REPO" -F has_issues=false -F has_wiki=false -F has_projects=false

# 6) Ruleset (create once; update by id if it already exists)
gh api -X POST "repos/$REPO/rulesets" --input - <<'EOF'
{
  "name": "default",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "exclude": [],
      "include": ["refs/heads/main", "refs/heads/staging"]
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "required_reviewers": [],
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "require_extra_approval_for_unattributed_changes": true,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [{ "context": "Required CI" }]
      }
    },
    { "type": "required_signatures" }
  ],
  "bypass_actors": []
}
EOF
```

### Verify (required before checking the box)

```bash
REPO=OWNER/REPO
gh api "repos/$REPO" --jq '{default_branch, security_and_analysis, has_issues, has_wiki, has_projects}'
gh api -i "repos/$REPO/vulnerability-alerts" | head -n 1   # expect 204
gh api "repos/$REPO/actions/permissions/workflow"
gh api "repos/$REPO/code-scanning/default-setup" --jq .state   # expect not-configured
gh api "repos/$REPO/rulesets" --jq '.[] | {id,name,enforcement}'
```

If secret scanning / Dependabot alerts still show disabled after PUT/PATCH, stop and fix permissions (repo admin) — do not document them as enabled.
