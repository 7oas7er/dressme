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

Photo upload flow: `POST /api/items` (or update with `addPhotos`) returns presigned PUT URLs; client uploads directly to the media bucket; then `photos/complete`.

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
