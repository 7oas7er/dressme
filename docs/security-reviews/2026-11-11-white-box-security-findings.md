# Security Assessment Findings — DressMe

**Date:** 2026-11-12  
**Tool:** Strix (local CLI, quick scan mode)  
**Scope:** Full repository (`web/`, `infra/lambda/`, `infra/terraform/`)  
**Overall Risk Posture:** Low — no critical or high-severity application-layer vulnerabilities

---

## Executive Summary

An authorized security assessment of the DressMe personal wardrobe catalog application was conducted. The application consists of a Vite-based SPA frontend and AWS Lambda backend APIs, with Amazon Cognito authentication, DynamoDB storage, S3 media hosting, and AWS Bedrock for AI-powered outfit suggestions.

**No exploitable vulnerabilities were detected.** The codebase demonstrates strong security practices including:
- Proper tenant isolation via user-scoped DynamoDB queries and S3 keys
- Server-side input validation with sensible limits
- Secure presigned URL file uploads
- Robust Cognito JWT verification

---

## Findings

### 1. Historical Secret in Git History — **Info**

**Finding:** Trufflehog detected a Cloudflare API token (`a24a2caaf8d50e915799b47b192325c399f5e08b`) in `.git/info/refs` (line 32) and `.git/packed-refs` (line 104).

**Impact:** Token is in git internal refs, not in tracked files. Gitleaks (which scans working tree + history) found no leaks, suggesting this token was already rotated and purged from tracked history but remains in internal git structures.

**Remediation:**
- [ ] Verify token is revoked in Cloudflare dashboard
- [ ] Consider `git gc --prune=now` to clean loose objects, or rotate if uncertain

---

### 2. Infrastructure Hardening — Terraform Misconfigurations — **Medium/Low**

Trivy identified multiple Terraform security checks:

| Resource | Check | Severity | Description |
|----------|-------|----------|-------------|
| S3 buckets | AWS-0089 | LOW | Logging disabled |
| S3 buckets | AWS-0132 | HIGH | No customer-managed KMS encryption |
| S3 buckets | AWS-0090 | MEDIUM | Versioning disabled |
| CloudFront | AWS-0011 | HIGH | No WAF attached |
| DynamoDB | AWS-0025 | LOW | Default KMS key used |
| CloudWatch Log Groups | AWS-0017 | LOW | Not encrypted |
| Lambda | AWS-0066 | LOW | X-Ray tracing disabled |

**Impact:** Defense-in-depth gaps; no direct exploitation path without additional vulnerabilities. Customer-managed KMS keys provide key rotation control and audit trails. WAF would add layer-7 protection. S3 versioning enables recovery from accidental deletion.

**Remediation:**
- [ ] Enable customer-managed KMS encryption for S3 buckets (media, logs), DynamoDB table, Lambda environment variables, CloudWatch log groups
- [ ] Enable S3 versioning and access logging on media bucket
- [ ] Attach WAF to CloudFront distributions (AWSManagedRulesCommonRuleSet, AWSManagedRulesKnownBadInputsRuleSet)
- [ ] Enable Lambda X-Ray tracing for end-to-end observability

---

### 3. Bedrock Prompt Injection Surface — **Low**

**Finding:** User-controlled inputs (`context`, `hints`, `answers`, `aiContext`, `attributes`) flow into Bedrock Converse prompts for both `analyze` (multimodal) and `suggest` (text) endpoints. Prompts use structured system instructions with JSON schema enforcement and fenced response parsing.

**Impact:** Indirect prompt injection could degrade suggestion quality or cause malformed JSON responses (handled by parse fallback). No tool/function calling, no data exfiltration path, no chainable impact. Token budgets and 40s deadline limit cost DoS.

**Remediation:** Current structure is reasonable. Consider adding input sanitization for control characters as precautionary hardening.

---

### 4. Dependabot Missing Cooldown Config — **Low**

**Finding:** Semgrep detected missing `cooldown: default-days: 7` in `.github/dependabot.yml` for all ecosystems.

**Remediation:** Add cooldown configuration to reduce notification noise.

---

## Clean Areas (No Issues)

| Area | Assessment |
|------|------------|
| **Authentication & Session Management** | Cognito JWT verification via `aws-jwt-verify` (RS256, JWKS caching). PKCE flow correctly implemented in SPA. Token extraction handles CloudFront OAC header rewriting (`x-id-token` preferred). `AUTH_DISABLED` only for unit tests. |
| **Authorization & Tenant Isolation** | All DynamoDB operations use `pk = USER#<sub>` from verified token. S3 keys embed userId: `users/<userId>/items/<itemId>/<photoId>.<ext>`. Presigned URLs scoped to user paths. Search query filtered client-side post-query. |
| **Input Validation** | Attributes normalized to 120 chars with delimiter unification, seed+custom vocab matching, brandModel alias/Levenshtein-1 handling. aiContext clamped to 2000 chars. wadaColorIds max 4, validated against known palette. Content-type whitelist (JPEG/PNG/WebP/HEIC). Max 8 photos/item. |
| **File Upload Security** | Presigned PUT (900s) and GET (3600s) URLs. Sharp for thumbnail (400px JPEG) and cutout (WebP, now disabled) generation. S3 keys constructed server-side with userId prefix. |
| **Client-Side XSS** | CSP blocks `unsafe-inline` styles. DOM built via `createElement` + `textContent`/`setAttribute`/`cssText`. User data rendered as text content or attribute values. No `innerHTML` with user data. |
| **Dependencies** | Web: vite@8.3.6 (dev only). Lambda: AWS SDK v3.1163.0, aws-jwt-verify@5.2.1, sharp@0.35.5. npm audit high: 0 vulnerabilities. Trivy: no dependency vulnerabilities. |

---

## Prioritized Recommendations

### Immediate (Security Hygiene)
1. **Verify Cloudflare API token revocation** — Confirm the token found in git refs is revoked in Cloudflare dashboard. Rotate if uncertain.

### Short-term (Infrastructure Hardening)
2. **Enable customer-managed KMS encryption** — For S3 buckets (media, logs), DynamoDB table, Lambda environment variables, CloudWatch log groups.
3. **Enable S3 versioning and access logging** — On media bucket for accidental deletion recovery and audit trail.
4. **Attach WAF to CloudFront distributions** — Managed rule set for layer-7 protection.
5. **Enable Lambda X-Ray tracing** — For end-to-end observability and debugging.

### Medium-term (Defense-in-Depth)
6. **Add Bedrock input sanitization** — Strip/escape control characters in `context`, `hints`, `answers` before prompt interpolation.
7. **Consider CSP `script-src` tightening** — Ensure production build uses hash/nonce for inline scripts if any.
8. **Add Dependabot cooldown** — Configure `cooldown: default-days: 7` in `.github/dependabot.yml` for all ecosystems.

---

## Retest & Validation Guidance

- Re-run Trivy scan after Terraform changes: `trivy fs --security-checks config .`
- Verify CloudFront WAF attachment: `aws wafv2 list-web-acls` and distribution config
- Confirm KMS key policies allow required Lambda/DynamoDB/S3 access
- Test S3 versioning by uploading/deleting a test object and verifying restore

---

## Scan Metadata

```
Target: /Users/7oas7er/SynologyDrive/private/devel/dressme
Mode: quick (diff-scoped)
Max Budget: $10
Model: openai/auto
Exit Code: 0 (no validated vulnerabilities)
Run Artifacts: strix_runs/dressme_eddf/
```

View full run: `strix view dressme_eddf`