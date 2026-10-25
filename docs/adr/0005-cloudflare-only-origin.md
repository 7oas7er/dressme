# 0005 — Cloudflare-only origin traffic

- **Status:** accepted
- **Date:** 2026-10-20

## Context

CloudFront (and similar origins) are guessable. Public apps in this pattern must not be reachable by bypassing the edge (rate limits, bot controls, DNS).

## Decision

Every public web app **only accepts traffic that arrived through Cloudflare**. Direct origin access (CloudFront URL, ALB DNS, etc.) must be rejected. Mechanism may vary by stack; DressMe uses a shared-secret `X-Origin-Verify` header injected by Cloudflare and checked by a CloudFront Function.

## Consequences

- Rotation procedure: [`infra/terraform/docs/origin-verify-secret-rotation.md`](../../infra/terraform/docs/origin-verify-secret-rotation.md).
- Agents must not remove or weaken the gate for convenience.
