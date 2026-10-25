# Browser security headers

## Ownership

| Layer | Role |
|-------|------|
| **CloudFront** `aws_cloudfront_response_headers_policy.site` | **Source of truth** for viewer security headers (CSP, HSTS, Referrer-Policy, X-Frame-Options, X-Content-Type-Options, Permissions-Policy, COOP, CORP). Attached to default + `/api/*` behaviors. Also removes `x-amzn-trace-id` and legacy `x-xss-protection` from responses. |
| **CloudFront Function** `strip_aws_headers` (viewer-response on `/api/*`) | Attempts to drop `x-amzn-trace-id`, `x-amzn-requestid`, and `x-amzn-errortype`. Needed because CloudFront **response-headers policies cannot remove** `X-Amzn-RequestId` / `X-Amzn-ErrorType` (AWS deny list). **Limitation:** with a Lambda Function URL origin, CloudFront re-attaches `x-amzn-requestid` after the viewer-response Function (confirmed live: Function can add headers, but `requestid` still appears). `x-amzn-trace-id` is still cleared via `remove_headers_config`. |
| **Cloudflare** | App root: DNS. Platform `shared-edge`: cache, rate limit, origin-verify **request** header. Does **not** set CSP / Permissions-Policy for this app — avoid duplicating security headers at the edge (double headers / override fights). |
| **S3 / Lambda origins** | Do not rely on origin-emitted security headers; CloudFront policy uses `override = true`. |

Change headers in Terraform (`infra/terraform/aws/modules/site/cloudfront.tf` + `locals.tf` + `strip_aws_headers.js.tftpl`), then `terraform apply` the env roots. Deploy of static files alone does **not** update CSP or header policy.

## Current policy (summary)

Defined in `local.content_security_policy` and the response headers policy:

- **CSP** (SPA + Cognito + media): `script-src 'self'`; `style-src`/`font-src` allow Google Fonts; `img-src`/`connect-src` allow `'self'`, blob/data previews, Cognito Hosted UI / IdP, and S3 presigned media hosts; `form-action` allows Cognito logout/authorize; `object-src 'none'`; `upgrade-insecure-requests`.
- **Permissions-Policy**: `camera=(self)` for wardrobe capture; mic/geo/payment/usb/sensors stay off.
- **HSTS**: 1y, `includeSubDomains`, `preload`.
- **COOP / CORP**: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` (defence-in-depth; no COEP — this app does not need `crossOriginIsolated`).
- **Others**: `nosniff`, `SAMEORIGIN` framing, `strict-origin-when-cross-origin` referrer.
- **Not set**: legacy `X-XSS-Protection` (omitted from `security_headers_config` and explicitly listed in `remove_headers_config`). After policy changes, bypass CloudFront cache (`?v=…` or invalidation) when verifying HTML — stale POPs can still show the old header set.

## AWS fingerprinting headers (`/api/health`)

| Header | Mechanism |
|--------|-----------|
| `x-amzn-trace-id` | `remove_headers_config` (+ Function) — **removed** in practice |
| `x-amzn-requestid` | viewer-response Function — **still visible** (CloudFront re-attaches after Function for Function URL origins) |
| `x-amzn-errortype` | viewer-response Function (error responses) |

`Via` and `x-amz-cf-*` cannot be removed via response-headers policy either; left as-is (no secrets).

## Changing headers / CSP safely

1. Edit `cloudfront.tf` / `locals.tf` / Function template → plan/apply **stg** first.
2. Hard-refresh the custom domain; check DevTools → Network → response headers (and console for CSP violations). For API: `curl -sSID - https://dressme-stg.7oas7er.com/api/health` and confirm `x-amzn-*` are gone and COOP/CORP are present on HTML.
3. Promote / apply **prod** only when stg is clean.
