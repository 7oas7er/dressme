# DressMe API Lambda

Runtime: Node.js 22 (`nodejs22.x`), arm64. Handler: `api.handler`.

Routes (CloudFront `/api/*` → Function URL):

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/health` | no | Liveness |
| GET | `/api/config` | no | Public Cognito SPA config |
| GET/POST | `/api/items` | Cognito JWT | List / create wardrobe items |
| GET/PUT/DELETE | `/api/items/{id}` | Cognito JWT | Read / update / delete |
| POST | `/api/items/{id}/photos/complete` | Cognito JWT | Mark uploads ready + generate overview thumbs (UC-20) |
| POST | `/api/photos/backfill-thumbs` | Cognito JWT | One-shot: generate missing thumbs for the caller’s items |
| GET | `/api/attribute-options` | Cognito JWT | Seed + per-user custom attribute suggestions (UC-19) |

Photo upload flow: `POST /api/items` (or update with `addPhotos`) returns presigned PUT URLs; client uploads directly to the media bucket; then `photos/complete`.

On `photos/complete`, the API downloads each newly ready object, writes a ~400px-wide JPEG thumbnail next to it (`*.thumb.jpg`), and stores `thumbKey` on the photo metadata. `GET /api/items` signs **thumb** URLs for overview cards; `GET /api/items/{id}` still signs full-resolution URLs (plus `thumbUrl`).

Update (`PUT /api/items/{id}`) may include `removePhotoIds: string[]` to drop specific photos (deletes the S3 object and its thumb when keyed, updates the DynamoDB photo list). Removals run before `addPhotos` so one request can replace photos.

Attribute suggestions (UC-19): Add/Edit forms load `/api/attribute-options` (classic menswear seeds plus the user’s remembered free-text values for type, color, fabric, brand/model, formality, pattern, season, outfit role). `brandModel` has no fixed seed list — every free-text value is remembered. Creating or updating an item persists any non-seed values under DynamoDB `META#attrOptions` on the same items table (no schema change).

### Staging backfill (existing photos)

After deploying the Lambda that includes UC-20, call once while signed in:

```bash
# From the browser console on https://dressme-stg.7oas7er.com/ (after login),
# or via any client that sends the Cognito ID token on x-id-token:
POST /api/photos/backfill-thumbs
```

Response: `{ processed, skipped, failed, updatedItems }`. Safe to re-run (skips photos that already have `thumbKey`).

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
