# 0009 — Bedrock for add-time Analyze (model pin + CRIS IAM)

- **Status:** accepted
- **Date:** 2026-11-07

## Context

UC-25 needs one multimodal proposal at catalog add time. UC-04 Bedrock text suggest (DM-44) reuses the same model pin and IAM — text Converse only, no photos. Block Drop has no Bedrock; DressMe must keep cost and least-privilege visible without inventing Guardrails/Budgets for solo v1.

## Decision

- **Model:** Claude Haiku 4.5 via EU inference profile (`bedrock_model_id` / `BEDROCK_MODEL_ID`); Analyze uses thumb-preferred images; suggest is text-only; `maxTokens: 1024`.
- **IAM:** `bedrock:InvokeModel` (+ stream) on the configured inference profile **and** the explicit EU foundation-model destinations CRIS may route to (home + listed EU regions). Do not shrink to home-region-only FMs — that surfaces as Analyze/Suggest 502/503. Suggest needs **no extra actions** while it shares `BEDROCK_MODEL_ID`.
- **Observability:** success paths log `modelId` + input/output token counts only (Analyze: `analyze_success`; Suggest: `suggest_success` + `suggestionId` / look count — never prompts, images, context text, or `aiContext`). Grafana Bedrock scrape/panels are separate.
- **Engine cutover:** `SUGGEST_ENGINE=bedrock|random` (Terraform); hard cutover with TF rollback — no silent random-on-Bedrock-failure. Body `engine` override kept for stg smoke.
- **Out of scope until needed:** Bedrock Guardrails, account Budgets, separate `BEDROCK_SUGGEST_MODEL_ID`.

## Consequences

- Analyze and Suggest depend on console model access + local aws apply for IAM/env ([`infra/terraform/docs/bedrock-catalog-assist.md`](../../infra/terraform/docs/bedrock-catalog-assist.md), [`bedrock-suggest.md`](../../infra/terraform/docs/bedrock-suggest.md)).
- Narrowing IAM to the wrong profile/FM set breaks Analyze and Suggest; smoke after every IAM pin change.
- Agents must not log prompt/image/context/`aiContext` content from Analyze or Suggest paths.
