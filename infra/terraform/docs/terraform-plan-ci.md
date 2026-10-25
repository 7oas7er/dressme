# Terraform plan in CI

Workflow: [`.github/workflows/terraform-plan.yml`](../../../.github/workflows/terraform-plan.yml).

Runs only when `infra/terraform/**`, `infra/lambda/**`, or this workflow file change (GitHub `paths:` filter). Separate from game deploy.

Within a run, **validate/plan are scoped per root** (`dorny/paths-filter`): e.g. a Cloudflare-only PR does not plan Grafana; `infra/lambda` changes only exercise AWS stg/prod. `workflow_dispatch` and edits to the workflow file still exercise every root.

| Job | What |
|-----|------|
| Detect changes | Builds per-root matrices |
| Format | `terraform fmt -check -recursive` (if any infra path matched) |
| IaC policy (Checkov) | Scans `infra/terraform` with [`../.checkov.yaml`](../.checkov.yaml); see [`docs/iac-policy.md`](../../../docs/iac-policy.md) |
| Validate | `init -backend=false` + `validate` for **changed** roots only |
| Plan AWS / Cloudflare / Grafana | Same scoping; OIDC plan role + provider tokens |

Apply stays local (or a future apply workflow). Plan exit code **2** (changes) is treated as success; only errors fail the job.

## One-time setup

### 1. Apply the plan role (stg)

```bash
export AWS_PROFILE=7oas7er
cd infra/lambda && npm ci --omit=dev
cd ../terraform/aws/envs/stg
terraform init -reconfigure   # backends no longer pin profile=
terraform apply               # creates shared-dressme-terraform-plan-role
```

Note the output `github_terraform_plan_role_arn`.

### 2. GitHub Environment `terraform`

Create Environment **terraform** (Settings → Environments). No deploy branch restriction required for plan-only.

**Variables**

| Name | Value |
|------|--------|
| `AWS_TERRAFORM_PLAN_ROLE_ARN` | `github_terraform_plan_role_arn` output |
| `STG_SITE_CERTIFICATE_ARN` | staging ACM cert ARN |
| `PROD_SITE_CERTIFICATE_ARN` | production ACM cert ARN (or omit if prod variable default is enough) |
| `STG_CLOUDFRONT_DOMAIN_NAME` | stg `distribution_domain_name` |
| `PROD_CLOUDFRONT_DOMAIN_NAME` | prod `distribution_domain_name` |
| `GRAFANA_STACK_SLUG` | Grafana Cloud stack slug |

**Secrets**

| Name | Value |
|------|--------|
| `STG_ORIGIN_VERIFY_SECRET` | same as stg AWS `origin_verify_secret` (AWS plan only) |
| `PROD_ORIGIN_VERIFY_SECRET` | same as prod AWS `origin_verify_secret` (AWS plan only) |
| `CLOUDFLARE_API_TOKEN` | Zone.DNS + Zone.Read for DressMe DNS-only Cloudflare plan |
| `GRAFANA_CLOUD_ACCESS_POLICY_TOKEN` | stacks:read (+ SA write if plan needs it) |
| `GRAFANA_CLOUD_PROVIDER_ACCESS_TOKEN` | integration-management scopes |
| `GRAFANA_SM_ACCESS_TOKEN` | Synthetic Monitoring token |

OIDC trust subject (already the Terraform default):

`repo:7oas7er@2952810/dressme@1433682888:environment:terraform`

If your GitHub subject string differs, set `github_actions_plan_subject` in stg tfvars and re-apply.

## Local commands after this change

Backends no longer set `profile = "7oas7er"`. Before any root:

```bash
export AWS_PROFILE=7oas7er
```

Keep `aws_profile = "7oas7er"` in local `terraform.tfvars` for the AWS provider where used.
