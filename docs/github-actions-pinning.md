# GitHub Actions — SHA pinning (template floor)

Every `uses:` in `.github/workflows/` must pin to a **full 40-character commit SHA**,
with the human version in a trailing comment:

```yaml
uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

This applies to **GitHub-owned** actions (`actions/*`, `github/codeql-action/*`) as well
as third-party ones. Mutable tags (`@v4`, `@v7.0.1`) can be moved by a compromised
upstream and are a supply-chain risk (CWE-829 / Strix H1).

## Automation

| Piece | Role |
|-------|------|
| [`.github/dependabot.yml`](../.github/dependabot.yml) `github-actions` | Weekly PRs → `staging` that bump SHAs (and comments) |
| [`.github/scripts/check-github-action-pins.sh`](../.github/scripts/check-github-action-pins.sh) | Fails CI if any workflow still uses a tag/branch ref |
| [Required CI](../.github/workflows/required-ci.yml) | Runs the pin check on every PR to `staging` / `main` |

Local check:

```bash
.github/scripts/check-github-action-pins.sh
```

## Resolving a tag → SHA

At pin time (do **not** copy SHAs from old reports):

```bash
# Lightweight tag (object is already a commit):
gh api "repos/OWNER/REPO/git/ref/tags/vX.Y.Z" --jq .object.sha

# Annotated tag (resolve tag object → commit):
T=$(gh api "repos/OWNER/REPO/git/ref/tags/vX.Y.Z" --jq .object.sha)
gh api "repos/OWNER/REPO/git/tags/$T" --jq .object.sha
```

For `github/codeql-action/init` and `…/analyze`, use the **same** repo tag SHA
(`github/codeql-action@vX.Y.Z`).

## New / migrated apps

Copy the pin script + Required CI step with the workflows. Keep Dependabot
`package-ecosystem: github-actions` targeting `staging`. Documented in
`app-deploy` / `app-core` and the new-app skill.
