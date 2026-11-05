# DressMe API Lambda

Runtime: Node.js 22 (`nodejs22.x`), arm64. Handler: `api.handler`.

Routes (CloudFront `/api/*` → Function URL):

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/health` | no | Liveness |
| GET | `/api/config` | no | Public Cognito SPA config |
| GET/POST | `/api/items` | Cognito JWT | List / create wardrobe items |
| GET/PUT/DELETE | `/api/items/{id}` | Cognito JWT | Read / update / delete |
| POST | `/api/items/{id}/photos/complete` | Cognito JWT | Mark uploads ready + generate overview thumbs (UC-20) + cutouts (B2/UC-24) |
| POST | `/api/photos/backfill-thumbs` | Cognito JWT | One-shot: generate missing thumbs for the caller’s items |
| POST | `/api/photos/backfill-cutouts` | Cognito JWT | Generate/upgrade cutouts for the caller’s items (B2). Body `{ force?: true, upgrade?: true }` regenerates existing mattes after an algo bump. |
| GET | `/api/attribute-options` | Cognito JWT | Seed + per-user custom attribute suggestions (UC-19) |
| POST | `/api/suggest` | Cognito JWT | Exactly three outfit looks from the catalog (UC-04–06); random assembly MVP, Bedrock later |

Photo upload flow: `POST /api/items` (or update with `addPhotos`) returns presigned PUT URLs; client uploads directly to the media bucket; then `photos/complete`.

On `photos/complete`, the API downloads each newly ready object, writes a ~400px-wide JPEG thumbnail next to it (`*.thumb.jpg`), and a transparent WebP cutout (`*.cutout.webp`) via a lean sharp edge-matte (corner-biased bg seed, hysteresis flood-fill, content crop — **not** rembg/ML, free-tier friendly). Stores `thumbKey` / `cutoutKey` / `cutoutVersion` on the photo metadata. Cutout failure is non-fatal (save still succeeds). `GET /api/items` signs **thumb** + **cutout** URLs for overview cards; `GET /api/items/{id}` still signs full-resolution URLs (plus `thumbUrl` / `cutoutUrl`).

Update (`PUT /api/items/{id}`) may include `removePhotoIds: string[]` to drop specific photos (deletes the S3 object and its thumb/cutout when keyed, updates the DynamoDB photo list). Removals run before `addPhotos` so one request can replace photos.

Attribute suggestions (UC-19): Add/Edit forms load `/api/attribute-options` (classic menswear seeds plus the user’s remembered free-text values for type, color, fabric, brand/model, formality, pattern, season, outfit role). `brandModel` has no fixed seed list — every free-text value is remembered. Creating or updating an item persists any non-seed values under DynamoDB `META#attrOptions` on the same items table (no schema change).

Outfit suggestions (UC-04–06): `POST /api/suggest` with `{ occasion, weather? }` returns exactly three looks, each a list of catalog items with signed photo URLs for the SPA layered collage (hero + authenticity strip). v1 uses **random** role-slot assembly (`outfitRole` / `type`); empty slots are skipped. Set `engine: "bedrock"` (or `SUGGEST_ENGINE=bedrock`) later to swap in attrs+IDs Bedrock — not wired yet (returns 501). No worn/like/reject persistence.

### Staging backfill (existing photos)

After deploying the Lambda that includes UC-20 / B2 cutouts (or a cutout algo bump), call once while signed in. The SPA auto-runs cutout backfill when any ready photo lacks `cutoutUrl`, and force-upgrades once per browser when `CUTOUT_VERSION` advances (only after the new Lambda is applied):

```bash
# From the browser console on https://dressme-stg.7oas7er.com/ (after login),
# or via any client that sends the Cognito ID token on x-id-token:
POST /api/photos/backfill-thumbs
POST /api/photos/backfill-cutouts
# After a matte algo bump (re-generate without re-upload):
POST /api/photos/backfill-cutouts   body: {"force":true}
```

Response: `{ processed, skipped, failed, updatedItems, cutoutVersion }`. Safe to re-run (skips photos that already have current `thumbKey` / `cutoutKey`+`cutoutVersion` unless `force`).

**Operator (stg Lambda apply required for API/matte changes):**

```bash
cd infra/lambda && npm run ci
AWS_PROFILE=7oas7er
cd infra/terraform/aws/envs/stg && terraform apply -target=module.site.aws_lambda_function.high_scores
```

Then sign in on staging (SPA auto force-upgrades) or `POST …/backfill-cutouts` with `{ "force": true }`. SPA deploys on merge via GitHub Actions; **do not claim staging Lambda updated until applied**.

**No Mac one-shot required** for the cutout *compute* — backfill runs in the existing API Lambda (same sharp stack as thumbs). Re-upload is not needed.

### CloudFront OAC + Cognito JWT

Function URL auth is `AWS_IAM` with CloudFront OAC `signing_behavior = always`. That **overwrites** the viewer `Authorization` header with SigV4. Clients must also send the Cognito **ID** token on `x-id-token` (the origin-verify CloudFront Function copies `Authorization: Bearer …` → `x-id-token` when missing). For `POST`/`PUT`/`PATCH` with a body, clients must send `x-amz-content-sha256` = hex SHA-256 of the exact body (same as Block Drop scores).

## Local

```bash
cd infra/lambda
npm ci            # host platform (for local tests; thumbs mocked)
npm test
# Vendored deps for Terraform archive_file (Lambda is linux/arm64; sharp must match):
npm run ci        # npm ci --omit=dev --os=linux --cpu=arm64
```

Unit tests set `AUTH_DISABLED=true` and mock DynamoDB/S3 modules (including `makeThumb`).
