# Security docs (follow-up)

Operator-facing security notes for DressMe. Prefer this folder for **remediation ledgers** and hardening backlog that are safe to keep in a public repo.

| Doc | Purpose |
|-----|---------|
| [`2026-11-11-remediation-follow-up.md`](2026-11-11-remediation-follow-up.md) | Staging pen-test follow-up: what landed, what is deferred (topics only) |

**Do not** put exploit steps, PoCs, raw scanner dumps, credential material, or open-vulnerability catalogs here. Curated Strix reviews and committed dumps live under [`docs/security-reviews/`](../security-reviews/). Report issues per root [`SECURITY.md`](../../SECURITY.md).

## Strix reviews

| Review | Entry |
|--------|-------|
| 2026-10-23 | [`../security-reviews/2026-10-23-strix.md`](../security-reviews/2026-10-23-strix.md) |
| 2026-11-11 | [`../security-reviews/2026-11-11-strix.md`](../security-reviews/2026-11-11-strix.md) (white-box + black-box dumps linked from there) |

Related: [`SECURITY.md`](../../SECURITY.md), [`docs/security-headers.md`](../security-headers.md), [`docs/github-branch-protection.md`](../github-branch-protection.md), [`docs/codeql.md`](../codeql.md).
