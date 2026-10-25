# Health Lambda (scaffold)

Runtime: Node.js 22 (`nodejs22.x`), arm64. Handler: `health.handler`.

Scaffold endpoint until Cognito + catalog/suggest Lambdas land (Option A).

## API

| Method | Path | Result |
|--------|------|--------|
| `GET` / `HEAD` | `/api/health` | `{ ok: true, service: "dressme", path: "/api/health" }` |

`@aws-sdk/client-s3` remains vendored for upcoming CRUD/media work; the health handler does not call S3 yet.

## Setup (before `terraform plan` / `apply`)

```bash
cd infra/lambda
npm ci --omit=dev
```

`node_modules/` is gitignored. Commit `package.json` and `package-lock.json` when changing dependencies.

## Tests

```bash
npm test
```
