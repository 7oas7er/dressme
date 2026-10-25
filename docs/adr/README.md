# Architecture decision records

Short “why” notes for irreversible or easy-to-re-litigate choices. Cursor rules (`.cursor/rules/` — platform `app-*` + product overlays) and [`AGENTS.md`](../../AGENTS.md) point agents at the norms; ADRs keep the reasoning durable.

## Rule of thumb

When you make a new **irreversible** (or expensive to reverse) choice — platform, apply model, observability product, traffic path, env promotion — add a ~½-page ADR here before or with the PR.

Template:

```markdown
# NNNN — Title

- **Status:** accepted | superseded by NNNN | deprecated
- **Date:** YYYY-MM-DD

## Context
What forced the choice?

## Decision
What we do.

## Consequences
What becomes easier / harder; what agents must not “helpfully” undo.
```

## Index

| ADR | Title |
|-----|--------|
| [0001](0001-static-game-delivery.md) | Static game delivery (no framework / bundler) |
| [0002](0002-terraform-not-cdk.md) | Terraform, not CDK |
| [0003](0003-local-terraform-apply.md) | Local `terraform apply` (not CI apply) |
| [0004](0004-grafana-first-observability.md) | Grafana-first; Cloudflare is not APM |
| [0005](0005-cloudflare-only-origin.md) | Cloudflare-only origin traffic |
| [0006](0006-github-env-separation.md) | GitHub Environment separation (`staging` / `production`) |
| [0007](0007-shared-edge-and-obs-platform.md) | Isolated apps + shared `7oas7er/platform` (edge + obs) |

Overall ownership diagram: [`../architecture.md`](../architecture.md). Canonical platform ADR: [`7oas7er/platform` ADR 0001](https://github.com/7oas7er/platform/blob/main/docs/adr/0001-shared-edge-and-obs.md).
