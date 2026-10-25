# IaC policy scan (Checkov)

CI job **IaC policy (Checkov)** in [`.github/workflows/terraform-plan.yml`](../.github/workflows/terraform-plan.yml) scans `infra/terraform/**` on every Terraform/lambda/workflow change.

Config: [`infra/terraform/.checkov.yaml`](../infra/terraform/.checkov.yaml).

Any **non-skipped** failed check fails the job (and should block merge once branch rules require that check).

## Suppressing a finding

Prefer **fixing** the Terraform when the check is right for this stack.

When a check conflicts with an intentional design (cost, Cloudflare-as-edge, single-region, etc.):

1. Add the check id to `skip-check` in `infra/terraform/.checkov.yaml`.
2. Put a **one-line justification** on the same line (or immediately above) in that file.
3. Mention the skip in the PR that introduces it.

Do **not** silence HIGH/CRITICAL issues without a written reason. Prefer narrow skips (one id) over turning soft-fail on for the whole scan.

### Inline skip (resource-level)

For a one-off resource, Checkov also honors:

```hcl
# checkov:skip=CKV_AWS_123: short justification
resource "aws_…" "example" {
  # …
}
```

Prefer the YAML allowlist for template-wide decisions so agents see one place.

## Local run

```bash
# If Checkov is installed (pip/brew):
checkov -d infra/terraform --config-file infra/terraform/.checkov.yaml
```

Or rely on the GitHub Actions job on the PR.
