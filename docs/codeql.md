# CodeQL (SAST)

Workflow: [`.github/workflows/codeql.yml`](../.github/workflows/codeql.yml)  
Config: [`.github/codeql/codeql-config.yml`](../.github/codeql/codeql-config.yml)

This is **advanced setup** checked into the repo. GitHub **default** code scanning setup must stay **off** (Settings → Code security → CodeQL → default setup) so the two do not fight. Sprint 5 disabled default setup via API when applying this change.

## What it covers

| Language pack | Paths |
|---------------|--------|
| `javascript-typescript` | `dressme/**`, `infra/lambda/**` |
| `actions` | `.github/workflows/**` |

Runs on PRs/pushes to `staging`/`main` when those paths change, plus a weekly schedule and `workflow_dispatch`. Query suite: **security-extended**.

Terraform is covered by Checkov (`docs/iac-policy.md`), not CodeQL.

## Expected alerts vs noise

| Kind | Action |
|------|--------|
| XSS / unsafe `innerHTML` / `document.write` in `dressme/js` | **Fix** (prefer `textContent` / DOM APIs) |
| Prototype pollution / tainted `eval` | **Fix** |
| Lambda path traversal / SSRF-style sinks if introduced | **Fix** |
| Alerts only in vendored `node_modules` | Should not appear (`paths-ignore`); if they do, tighten config |
| Low-confidence style findings that do not match our static CSP model | Open a PR note and add a [CodeQL alert dismissal](https://docs.github.com/en/code-security/code-scanning/managing-code-scanning-alerts/triaging-code-scanning-alerts-in-pull-requests) with reason, or a narrow `# codeql[rule-id]` suppress only with justification |

There is no committed `# codeql` ignore list yet — prefer fixing or dismissing in the GitHub UI with a written reason.

## Local / CI

- Findings show on the PR **Code scanning** UI and the **Analyze (…)** jobs.
- Do not add Semgrep/Snyk SAST unless replacing CodeQL with an ADR.
