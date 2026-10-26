# Architecture — DressMe in the solo+AI platform

## Fundamental split

**Each app is an isolated repository.** Shared multi-tenant edge and Grafana Free objects live in [`7oas7er/platform`](https://github.com/7oas7er/platform). This app depends on platform; it must **not** be a dependency of Block Drop, Netrunner, or any sibling.

```text
7oas7er/platform  (shared-edge, shared-obs)
        ▲
        │  app → platform only
        │
   dressme (this repo)     block-drop / netrunner / future apps
```

Full platform write-up: [platform docs/architecture.md](https://github.com/7oas7er/platform/blob/main/docs/architecture.md). Decision: [ADR 0007](adr/0007-shared-edge-and-obs-platform.md) (mirrors platform ADR 0001). Product architecture: [ADR 0008](adr/0008-option-a-serverless-cognito.md).

## v1 contract (Option A — planned)

Frozen product/tech inputs: wardrobe catalog + suggest (UC-01–06, UC-18), single user, Bedrock **attributes + item IDs only**, client-side flat-lay collage.

| Layer | Choice |
|-------|--------|
| Frontend | SPA on S3/CloudFront (`dressme/`; small bundler OK) |
| Auth | **Cognito** user pool (one user in v1) |
| API | Lambda (Function URL or HTTP API) behind CloudFront `/api/*` |
| Items | **DynamoDB** metadata |
| Photos | Private **S3 media** + presigned uploads |
| Suggest | Lambda → **Bedrock** (`eu-north-1`) with attrs+IDs; validate returned IDs |
| Collage | **Client-side** from signed/CDN photo URLs |

Catalog (UC-01–03, UC-18) lands Cognito + DynamoDB + media S3 + `/api/items*` on the API Lambda; suggest/collage (UC-04–06) remains follow-up. Domains: `dressme.7oas7er.com` / `dressme-stg.7oas7er.com`.

## What this repo owns

| Path | Role |
|------|------|
| `web/` | Vite SPA source (catalog UI + Cognito Hosted UI PKCE) |
| `dressme/` | Vite build output synced to S3 |
| `infra/terraform/aws/` | S3, CloudFront, Lambda, Cognito, DynamoDB, media, OIDC deploy/plan |
| `infra/terraform/cloudflare/` | **DNS only** for DressMe hosts |
| `infra/terraform/grafana/` | Folder, **prod+stg** dashboards, synthetics, CloudWatch scrape, GitHub DS `github-dressme` |
| `.github/workflows/` | Tests, deploy, terraform plan (never apply) |

## What platform owns (do not recreate here)

- Zone rulesets: origin-verify, cache, redirects, API rate limit, SSL — extend for DressMe hosts in `shared-edge`
- Shared Infinity DS `infinity-cloudflare` and GitHub catalog **plugin**

## Traffic path

Browser → Cloudflare (custom domain) → inject `X-Origin-Verify` → CloudFront → S3 (and `/api/*` → Lambda). Direct CloudFront URLs return 403.

## Operator follow-ups (first apply)

1. Platform `shared-edge`: origin-verify secrets + cache/transform hosts for `dressme` / `dressme-stg`.
2. Local Terraform: bootstrap → `aws/envs/stg` → Cloudflare DNS → Grafana (then prod when ready).
3. GitHub Environments `staging` / `production` / `terraform` + OIDC subjects (prefer immutable `repo:7oas7er@2952810/dressme@<id>:environment:…` after repo id is known).
