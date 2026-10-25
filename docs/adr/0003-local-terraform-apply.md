# 0003 — Local `terraform apply` (not CI apply)

- **Status:** accepted
- **Date:** 2026-10-20

## Context

CI `terraform apply` needs apply roles, Environment approvals, blast-radius discipline, and recovery playbooks. For one operator, local apply with `AWS_PROFILE=7oas7er` after reviewing a CI plan is simpler and less surprising.

## Decision

GitHub Actions **plans only** (see `.github/workflows/terraform-plan.yml`). **Never** add or run `terraform apply` in Actions unless Frank explicitly requests it and a new ADR supersedes this one. Apply locally after reviewing plan output.

## Consequences

- Docs and agents remind Frank to plan/apply when Terraform changes.
- P2.4 in the template backlog tracks intentional deferral of CI apply.
