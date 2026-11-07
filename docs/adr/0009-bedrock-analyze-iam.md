# 0009 — Bedrock for add-time Analyze (model pin + CRIS IAM)

- **Status:** accepted
- **Date:** 2026-11-07

## Context

UC-25 needs one multimodal proposal at catalog add time. Outfit suggest stays random until DM-44. Block Drop has no Bedrock; DressMe must keep cost and least-privilege visible without inventing Guardrails/Budgets for solo v1.

## Decision

- **Model:** Claude Haiku 4.5 via EU inference profile (`bedrock_model_id` / `BEDROCK_MODEL_ID`); thumb-preferred images; `maxTokens: 1024`.
- **IAM:** `bedrock:InvokeModel` (+ stream) on the configured inference profile **and** the explicit EU foundation-model destinations CRIS may route to (home + listed EU regions). Do not shrink to home-region-only FMs — that surfaces as Analyze 502/503.
- **Observability:** success path logs `modelId` + input/output token counts only (never prompts, images, or `aiContext`). Grafana Bedrock scrape/panels are a separate change.
- **Out of scope until needed:** Bedrock Guardrails, account Budgets, text suggest engine swap (`SUGGEST_ENGINE=bedrock`).

## Consequences

- Analyze depends on console model access + local aws apply for IAM/env ([`infra/terraform/docs/bedrock-catalog-assist.md`](../../infra/terraform/docs/bedrock-catalog-assist.md)).
- Narrowing IAM to the wrong profile/FM set breaks Analyze; smoke after every IAM pin change.
- Agents must not log prompt/image/`aiContext` content from the Analyze path.
