# 0009 — Bedrock for add-time Analyze (model pin + CRIS IAM)

- **Status:** accepted
- **Date:** 2026-11-07

## Context

UC-25 needs one multimodal proposal at catalog add time. UC-04 Bedrock text suggest (DM-44) shares Bedrock IAM/region and may use a separate Suggest model pin — text Converse only, no photos. Block Drop has no Bedrock; DressMe must keep cost and least-privilege visible without inventing Guardrails/Budgets for solo v1.

## Decision

- **Model:** Analyze stays on Claude Haiku 4.5 via EU inference profile (`bedrock_model_id` / `BEDROCK_MODEL_ID`); thumb-preferred images; `maxTokens: 1024`. Suggest is text-only and may use a separate pin (`suggest_model_id` / `SUGGEST_MODEL_ID`, e.g. Sonnet trial on stg); empty Suggest pin falls back to the Analyze model.
- **IAM:** `bedrock:InvokeModel` (+ stream) on the configured Analyze **and** Suggest inference profiles **and** the explicit EU foundation-model destinations CRIS may route to for each family (home + listed EU regions). Do not shrink to home-region-only FMs — that surfaces as Analyze/Suggest 502/503.
- **Observability:** success paths log `modelId` + input/output token counts only (Analyze: `analyze_success`; Suggest: `suggest_success` + `suggestionId` / look count / shortfall + repair counters — never prompts, images, context text, or `aiContext`). Grafana Bedrock scrape/panels are separate.
- **Engine cutover:** `SUGGEST_ENGINE=bedrock|random` (Terraform); hard cutover with TF rollback — no silent random-on-Bedrock-failure. Body `engine` override kept for stg smoke.
- **Out of scope until needed:** Bedrock Guardrails, account Budgets, prod Sonnet pin (stg trial first).

## Consequences

- Analyze and Suggest depend on console model access + local aws apply for IAM/env ([`infra/terraform/docs/bedrock-catalog-assist.md`](../../infra/terraform/docs/bedrock-catalog-assist.md), [`bedrock-suggest.md`](../../infra/terraform/docs/bedrock-suggest.md)).
- Narrowing IAM to the wrong profile/FM set breaks Analyze and Suggest; smoke after every IAM pin change.
- Agents must not log prompt/image/context/`aiContext` content from Analyze or Suggest paths.
