# Security remediation follow-up — 2026-11-11

Point-in-time ledger after a **staging** pen-test of DressMe solo v1. Safe for the public repo: no exploit detail, no PoCs, no open-finding catalog.

## What was reviewed

| | |
|--|--|
| **When** | 2026-11-11 |
| **Where** | Staging environment + matching app/IaC tree (solo v1) |
| **Kinds** | Black-box live check of the staging site/API surface; white-box review of SPA, Lambda, Terraform, and CI hygiene |
| **Product context** | Single-user wardrobe app (Frank); MVP complete; AWS spend ceiling still applies |

**Outcome (high level):** no emergency auth or tenant-isolation hotfixes required for solo v1. Remaining work is hygiene already merged, optional later hardening, and operator applies still pending for Terraform.

Curated entry + dumps: [`../security-reviews/2026-11-11-strix.md`](../security-reviews/2026-11-11-strix.md) (white-box and black-box linked from there). Keep **this** file free of exploit steps and open-finding catalogs.

## Remediations landed

| Change | Status | Notes |
|--------|--------|-------|
| Dependabot ecosystem `cooldown` (7 days) | Merged [#125](https://github.com/7oas7er/dressme/pull/125) | Repo config only; no AWS apply |
| Media bucket S3 server access logging → existing access-logs prefix | Merged [#126](https://github.com/7oas7er/dressme/pull/126) | **Local `terraform apply` still required** (stg first; prod on promote). Frank owns apply. |

False-positive scanner noise from the same review was closed in the private plan; nothing further is required in-repo for those items.

## Deferred / harden later (topics only)

Track as backlog themes when multi-user, public share, compliance, or abuse makes them worth the cost. **No implementation recipes here.**

| Topic | When it matters | Owner surface |
|-------|-----------------|---------------|
| Bedrock / LLM prompt-field hardening | Before multi-user or untrusted input paths widen | dressme Lambda |
| Cognito signup / pool posture (invite-only, SPA client least privilege) | Before multi-user or broader account creation | dressme Cognito Terraform |
| Edge rate-limit / rules tuning for DressMe API paths | If abuse shows up on Free Cloudflare plan | platform `shared-edge` (not AWS WAF on the CF distribution by default) |
| Customer-managed KMS / deeper log-group encryption | Multi-tenant or compliance ask | dressme Terraform |
| Lambda X-Ray | Only if debugging needs justify cost | dressme Terraform |

**Explicit non-goal for v1 unless asked:** attaching AWS WAFv2 to CloudFront while Cloudflare remains the L7 edge (duplicate cost).

## How to use this doc

1. After Frank applies media logging Terraform on stg, tick that apply in whatever operator checklist you use (this file can gain a one-line “applied stg YYYY-MM-DD” note in a later PR).
2. Open follow-up PRs for deferred **topics** only when the product posture changes — prefer small, single-theme PRs into `staging`.
3. Keep new public security docs under [`docs/security/`](./) in the same safe style. Do not paste scanner finding IDs, bypass narratives, or credential checks into PRs.

## Related

- Curated Strix review + dumps: [`../security-reviews/2026-11-11-strix.md`](../security-reviews/2026-11-11-strix.md)
- Root reporting / secret rotation: [`SECURITY.md`](../../SECURITY.md)
- Browser headers: [`docs/security-headers.md`](../security-headers.md)
- GitHub security floor: [`docs/github-branch-protection.md`](../github-branch-protection.md)
- CodeQL: [`docs/codeql.md`](../codeql.md)
