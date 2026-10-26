# DressMe SPA (Vite)

Source for the wardrobe catalog UI. Build output lands in `../dressme/` for S3 deploy.

```bash
cd web
npm ci
npm run build
npm run dev   # optional; proxies /api to stg unless DRESSME_API_PROXY is set
```

Auth: Cognito Hosted UI (PKCE). Catalog config is loaded at runtime from `GET /api/config`.
