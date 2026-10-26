# DressMe API Lambda

Runtime: Node.js 22 (`nodejs22.x`), arm64. Handler: `api.handler`.

Routes (CloudFront `/api/*` → Function URL):

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/health` | no | Liveness |
| GET | `/api/config` | no | Public Cognito SPA config |
| GET/POST | `/api/items` | Cognito JWT | List / create wardrobe items |
| GET/PUT/DELETE | `/api/items/{id}` | Cognito JWT | Read / update / delete |
| POST | `/api/items/{id}/photos/complete` | Cognito JWT | Mark presigned uploads ready |
| GET | `/api/attribute-options` | Cognito JWT | Seed + per-user custom attribute suggestions (UC-19) |

Photo upload flow: `POST /api/items` (or update with `addPhotos`) returns presigned PUT URLs; client uploads directly to the media bucket; then `photos/complete`.

Update (`PUT /api/items/{id}`) may include `removePhotoIds: string[]` to drop specific photos (deletes the S3 object when keyed, updates the DynamoDB photo list). Removals run before `addPhotos` so one request can replace photos.

Attribute suggestions (UC-19): Add/Edit forms load `/api/attribute-options` (classic menswear seeds plus the user’s remembered free-text values). Creating or updating an item persists any non-seed values under DynamoDB `META#attrOptions` on the same items table (no schema change).

### CloudFront OAC + Cognito JWT

Function URL auth is `AWS_IAM` with CloudFront OAC `signing_behavior = always`. That **overwrites** the viewer `Authorization` header with SigV4. Clients must also send the Cognito **ID** token on `x-id-token` (the origin-verify CloudFront Function copies `Authorization: Bearer …` → `x-id-token` when missing). For `POST`/`PUT`/`PATCH` with a body, clients must send `x-amz-content-sha256` = hex SHA-256 of the exact body (same as Block Drop scores).

## Local

```bash
cd infra/lambda
npm ci
npm test
# Vendored deps for Terraform archive_file:
npm ci --omit=dev
```

Unit tests set `AUTH_DISABLED=true` and mock DynamoDB/S3 modules.
