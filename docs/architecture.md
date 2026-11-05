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

Frozen product/tech inputs: wardrobe catalog + suggest (UC-01–07, UC-18–21), single user, Bedrock **attributes + item IDs only**, client-side layered collage (hero + authenticity strip; cutouts later).

| Layer | Choice |
|-------|--------|
| Frontend | SPA on S3/CloudFront (`dressme/`; small bundler OK) |
| Auth | **Cognito** user pool (one user in v1) |
| API | Lambda (Function URL or HTTP API) behind CloudFront `/api/*` |
| Items | **DynamoDB** metadata |
| Photos | Private **S3 media** + presigned uploads; UC-20 ~400px JPEG thumbs (`*.thumb.jpg`) for catalog overview |
| Suggest | Lambda → **Bedrock** (`eu-north-1`) with attrs+IDs; validate returned IDs |
| Collage | **Client-side** CSS compositor (`lookLayout.js` / `lookCard.js`) from signed/CDN photo URLs; Option 4 chrome + Option 1 photo layers |

Catalog (UC-01–03, UC-07, UC-18–21) lands Cognito + DynamoDB + media S3 + `/api/items*` / `/api/photos/backfill-thumbs` and `/api/attribute-options` on the API Lambda, with add/edit form field baselines aligned (UC-21) and client-side attribute filters above the catalog grid (UC-07). Suggest/collage (UC-04–06): `POST /api/suggest` returns three looks; MVP uses **random** role-slot assembly (Bedrock attrs+IDs later via the same route / `SUGGEST_ENGINE`); SPA renders per-look layered heroes + right authenticity strips from signed photo URLs (B1; cutouts B2) with no worn/like/reject recording. Domains: `dressme.7oas7er.com` / `dressme-stg.7oas7er.com`.

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
