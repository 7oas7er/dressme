# 0004 — Grafana-first observability; Cloudflare is not APM

- **Status:** accepted
- **Date:** 2026-10-20

## Context

Multiple monitoring SaaS products (Checkly, Datadog, New Relic, Cloudflare as a second APM) raise cost, tokens, and AI drift. Grafana Cloud Free already covers synthetics, CloudWatch scrape, and dashboards; Cloudflare edge analytics can be **pulled into** Grafana via GraphQL.

## Decision

**Grafana Cloud Free** is the only observability product. Cloudflare stays DNS/edge (plus analytics ingested into Grafana). Do not add a second monitoring SaaS without an explicit reason and a superseding ADR.

## Consequences

- Terraform for observability lives under `infra/terraform/grafana/`.
- Agents must not “helpfully” add Checkly/Datadog/etc. or turn Cloudflare into application monitoring.
- App dashboards follow the dual-env template in [`docs/grafana-dashboard-template.md`](../grafana-dashboard-template.md) (Production + Staging; fixed-window traffic/errors/latency; synthetics; Cloudflare edge; GitHub CI) — same pattern as DressMe and Netrunner.
