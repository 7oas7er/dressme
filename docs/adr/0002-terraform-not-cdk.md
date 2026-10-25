# 0002 — Terraform, not CDK

- **Status:** accepted
- **Date:** 2026-10-20

## Context

Early experiments left CloudFormation/CDK residue. For a solo + AI workflow, declarative HCL in discrete roots (AWS / Cloudflare / Grafana) is easier to review, plan in CI, and apply locally than generated stacks.

## Decision

**Terraform is the source of truth** for AWS, Cloudflare, and Grafana. Do not reintroduce CDK or manage app resources with CloudFormation. Separate state keys per root under the shared state bucket.

## Consequences

- CI runs fmt / validate / plan (and Checkov); apply stays local ([0003](0003-local-terraform-apply.md)).
- Agents match existing module/root patterns; no parallel IaC frameworks.
