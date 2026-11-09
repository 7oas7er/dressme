# DressMe API Lambda

Runtime: Node.js 22 (`nodejs22.x`), arm64. Handler: `api.handler`.

Routes (CloudFront `/api/*` → Function URL):

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/health` | no | Liveness |
| GET | `/api/config` | no | Public Cognito SPA config |
| GET/POST | `/api/items` | Cognito JWT | List / create wardrobe items |
| GET/PUT/DELETE | `/api/items/{id}` | Cognito JWT | Read / update / delete |
| POST | `/api/items/{id}/photos/complete` | Cognito JWT | Mark uploads ready + generate overview thumbs (UC-20). Cutout generation disabled (Option D). Also used after UC-18 client rotate (remove+add re-upload). |
| POST | `/api/photos/backfill-thumbs` | Cognito JWT | One-shot: generate missing thumbs for the caller’s items |
| POST | `/api/photos/backfill-cutouts` | Cognito JWT | **Noop** while `CUTOUTS_ENABLED=false` (returns `{ disabled: true }`). Existing S3/Dynamo cutout keys left in place. |
| GET | `/api/attribute-options` | Cognito JWT | Seed + per-user custom attribute suggestions (UC-19) |
| POST | `/api/items/analyze` | Cognito JWT | UC-25 add-time AI assist: one Bedrock multimodal call → proposed attrs + `aiContext` (no Dynamo write) |
| POST | `/api/suggest` | Cognito JWT | Exactly three outfit looks + rationale (UC-04–06, UC-09); Bedrock text or random via `SUGGEST_ENGINE` |

Photo upload flow: `POST /api/items` (or update with `addPhotos`) returns presigned PUT URLs; client uploads directly to the media bucket; then `photos/complete`.

On `photos/complete`, the API downloads each newly ready object and writes a ~400px-wide JPEG thumbnail next to it (`*.thumb.jpg`). **Cutout generation is stopped** (`CUTOUTS_ENABLED=false` in `items.js` — Option D SVG mannequin hero); existing `cutoutKey` values are left untouched. `GET /api/items` signs **thumb** URLs (and still signs cutout URLs when an old key exists); SPA prefers photographic thumbs/originals. `GET /api/items/{id}` still signs full-resolution URLs.

Update (`PUT /api/items/{id}`) may include `removePhotoIds: string[]` to drop specific photos (deletes the S3 object and its thumb/cutout when keyed, updates the DynamoDB photo list). Removals run before `addPhotos`; when the same PUT both removes and adds, new photos are inserted at the removed indices. UC-18 edit rotate uses `replacePhotos: [{ photoId, contentType }]` instead — same `photoId` / array slot, pending + presigned PUT overwrite, then `photos/complete` regenerates the thumb. UC-18 designate catalog photo: `primaryPhotoId` (applied after remove/replace/add) moves that photo to index 0; other photos keep relative order. New `addPhotos` still append (they do not steal primary). Catalog overview already uses the first displayable photo.

Attribute suggestions (UC-19): Add/Edit forms load `/api/attribute-options` (classic menswear seeds plus the user’s remembered free-text values for type, color, fabric, brand/model, formality, pattern, season, outfit role). `brandModel` has no fixed seed list — every free-text value is remembered. Creating or updating an item persists any non-seed values under DynamoDB `META#attrOptions` on the same items table (no schema change).

Attribute hygiene (Phase 1): `attrNormalize.js` (twin of `web/src/attrNormalize.js`) runs on create/update — trim/collapse whitespace, delimiter unify (`/` `|` `;` `&` → `, `), strip trailing `.`/`,`, then silent fold-match rewrite to seed/custom spelling. Typo (Levenshtein-1) matches are never auto-applied server-side; the SPA shows **Did you mean…?** chips. Colors stay one string. No admin merge API in Phase 1.

Add-time AI assist (UC-25): `POST /api/items/analyze` with either `{ imageBase64, contentType? }` (new upload) or `{ itemId, photoId? }` (existing ready photo; prefers thumb). Optional `hints` / `answers` / partial `attributes`. Returns a proposal Frank must apply and save — analyze never writes Dynamo. On success, Lambda logs one JSON line (`analyze_success` + `modelId` + input/output token counts only — never prompts, images, or `aiContext`). Requires Bedrock model access + Lambda IAM (see `infra/terraform/docs/bedrock-catalog-assist.md`, ADR 0009).

Outfit suggestions (UC-04–06 + UC-09): `POST /api/suggest` with `{ context }` (≤480 chars; legacy `{ occasion, weather? }` shim concatenates) returns exactly three looks, each with optional `title` + `rationale` + catalog items with signed photo URLs. Default engine = Lambda `SUGGEST_ENGINE` (`bedrock` \| `random`); body `engine` overrides for smoke. Bedrock path: text Converse over attrs + `aiContext` only (no photos); validates item IDs; hard mandatory-core completeness (base + bottom + footwear when catalog has shoes; accessories optional); hard-fails on model errors or incomplete looks after one repair (`suggest_incomplete_looks`, no silent random fallback). Success logs `suggest_success` + `suggestionId` + `modelId` + token counts. SPA: photos-only look cards + Wada plate; rationale below the look body. See `infra/terraform/docs/bedrock-suggest.md`. No worn/like/reject persistence.

Item field `aiContext` (optional string, ≤2000 chars) stores durable notes from assist for later text suggest.

### Staging thumbs backfill (existing photos)

After deploying UC-20 thumbs (already on staging), call once while signed in if any ready photo lacks a thumb:

```bash
# From the browser console on https://dressme-stg.7oas7er.com/ (after login):
POST /api/photos/backfill-thumbs
```

`POST /api/photos/backfill-cutouts` remains routed but **noops** (`{ disabled: true, processed: 0 }`) while cutouts are stopped. Existing `*.cutout.webp` objects are **not** deleted.

**Operator (stg Lambda apply required to stop cutout gen on upload):**

```bash
cd infra/lambda && npm run ci
AWS_PROFILE=7oas7er
cd infra/terraform/aws/envs/stg && terraform apply -target=module.site.aws_lambda_function.high_scores
```

SPA (mannequin hero + catalog no longer preferring cutouts) deploys on merge via GitHub Actions; **Lambda cutout-stop needs the Mac apply above** — do not claim staging API updated until applied.

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
