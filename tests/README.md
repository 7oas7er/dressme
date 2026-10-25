# DressMe tests

Automated checks for the static game under `../dressme/`. The game itself stays free of a package manager; this folder owns Node, Playwright, and a pinned `serve` for the e2e static host.

## What runs

| Suite | Tool | Covers |
|-------|------|--------|
| `unit/` | Node.js test runner + coverage | Move, rotate, lock/clear, pause/restart, high-score helpers |
| `e2e/` | Playwright (Chromium) | Page chrome, high-score list, keyboard move/rotate, pause |

CI runs `npm test` when `staging` or `main` is updated (see `.github/workflows/deploy-dressme.yml`). Deploy follows only if `dressme/**` (or the workflow file) changed — not for `tests/**`-only pushes.

## Local

```bash
cd tests
npm ci
npx playwright install chromium
npm test
```

Unit only: `npm run test:unit`  
E2E only: `npm run test:e2e`
