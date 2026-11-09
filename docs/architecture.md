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

Frozen product/tech inputs: wardrobe catalog + suggest (UC-01–07, UC-18–21, UC-25), single user; **add-time** Bedrock multimodal assist for attrs + `aiContext` (UC-25); outfit suggest stays attrs+IDs(+context) only (no photos on suggest); photos-only look cards + Wada plate (Option D SVG mannequin retired for v1 UI; cutout generation stopped; UC-24 not required).

| Layer | Choice |
|-------|--------|
| Frontend | SPA on S3/CloudFront (`dressme/`; small bundler OK) |
| Auth | **Cognito** user pool (one user in v1) |
| API | Lambda (Function URL or HTTP API) behind CloudFront `/api/*` |
| Items | **DynamoDB** metadata |
| Photos | Private **S3 media** + presigned uploads; UC-20 ~400px JPEG thumbs (`*.thumb.jpg`); cutout generation stopped (existing `*.cutout.webp` keys left in place; UC-24 not required) |
| Catalog assist | Lambda → **Bedrock multimodal** (`eu-north-1`) on add/edit (`POST /api/items/analyze`); human confirms before save |
| Suggest | Lambda → **Bedrock text** Haiku (`eu-north-1`) attrs+IDs+`aiContext` (no photos); validate returned IDs; `SUGGEST_ENGINE=random` rollback |
| Look cards | **Client-side** photos-only pieces + Wada plate (`lookCard.js` / `lookWadaPlate.js`); mannequin helpers retained for Later hero |

Catalog (UC-01–03, UC-07, UC-18–21, UC-25) lands Cognito + DynamoDB + media S3 + `/api/items*` / `/api/items/analyze` / `/api/photos/backfill-thumbs` and `/api/attribute-options` on the API Lambda (UC-18 edit rotate is client canvas → `replacePhotos` same-`photoId` overwrite → `photos/complete` thumbs; no server pixel-rotate route; UC-18 designate catalog photo is `primaryPhotoId` on PUT → move that entry to `photos[0]`), with add/edit form field baselines aligned (UC-21) and client-side attribute filters above the catalog grid (UC-07). Add-time AI assist (UC-25) proposes attrs + durable `aiContext` via one multimodal Bedrock call; Frank reviews before save. Suggest (UC-04–06 + UC-09): `POST /api/suggest` with `{ context }` returns N looks (default 3, clamp 1–8 from context) + per-look `title` + `rationale`; default engine via `SUGGEST_ENGINE` (`bedrock` after stg cutover; `random` for TF rollback). Bedrock path is text-only Converse over catalog attrs + `aiContext` (no photos; reuses Analyze IAM/model per ADR 0009); hard mandatory-core completeness (base + bottom + footwear-when-available). SPA: single Context field; photos-only look cards + Wada plate; tappable pieces → detail with Back to looks; rationale below each look body. Domains: `dressme.7oas7er.com` / `dressme-stg.7oas7er.com`.

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
