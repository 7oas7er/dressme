# 0006 — GitHub Environment separation (`staging` / `production`)

- **Status:** accepted
- **Date:** 2026-10-20

## Context

One AWS account, two app environments (`stg` / `prod`). Collapsing GitHub Environments onto the same role, bucket, or distribution makes “promote” a silent prod write.

## Decision

- Feature work merges to **`staging`** → deploys **AWS stg** only.
- Promote by merging **`staging` → `main`** → deploys **AWS prod**.
- GitHub Environments `staging` and `production` hold **distinct** deploy roles, buckets, and distributions. Do not point both at the same resources.

## Consequences

- PRs target `staging` unless Frank asks for a promote-to-`main` PR.
- Agents must not invent prod-only shortcuts or shared deploy credentials across envs.
