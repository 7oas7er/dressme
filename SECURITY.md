# Security

## Reporting

This is the DressMe app repo. If you find a vulnerability in the public site, edge config, or Lambda:

1. Contact Frank (repo owner) directly — do not open a public issue with exploit detail.
2. Include host/env (`stg` vs `prod`), rough impact, and steps to reproduce if safe.

There is no bug bounty.

## Secrets — never commit

Do not commit `.tfstate`, `terraform.tfvars`, API tokens, AWS keys, Grafana tokens, Cloudflare tokens, origin-verify secrets, or GitHub PATs. Prefer gitignored tfvars, GitHub Environment secrets/vars, or shell env vars.

## If a secret leaks

Act fast; assume compromise until rotated. Prefer **stg first**, then **prod**, when both are affected.

| Secret | What to do |
|--------|------------|
| **Origin-verify** (`X-Origin-Verify`) | Follow [`infra/terraform/docs/origin-verify-secret-rotation.md`](infra/terraform/docs/origin-verify-secret-rotation.md). Dual-accept on AWS, update Cloudflare, drop previous. Direct CloudFront URLs must keep failing. |
| **Cloudflare API token** (`CLOUDFLARE_API_TOKEN` / analytics `cfat_`) | Revoke in Cloudflare dashboard → create replacement → update local env / gitignored tfvars **and** GitHub Environment secrets (`staging`, `production`, `terraform` as used) → re-run any Terraform plan that needs it. |
| **Grafana** (`GRAFANA_*`, SM token, cloud/provider tokens in `infra/terraform/grafana` tfvars) | Revoke/rotate in Grafana Cloud → update gitignored `terraform.tfvars` / env vars → `terraform plan` in `infra/terraform/grafana` so stacks still authenticate. Rotate service-account keys used for dashboard publish the same way. |
| **GitHub PAT** (e.g. Grafana GitHub data source) | Revoke the PAT in GitHub → create a fine-grained replacement with least privilege → update the Grafana datasource secret / Terraform var. |
| **AWS** (access keys; unusual — prefer OIDC + profile `7oas7er`) | Deactivate key in IAM immediately → issue replacement only if still needed → scrub from shell history/CI. Prefer fixing the process to OIDC/profile instead of long-lived keys. |
| **GitHub Actions deploy/plan** | Rotate is IAM trust + Environment config, not a pasted key. If an Environment secret was exposed, rotate that secret and review recent runs. |

After rotation, confirm synthetics / a manual hit on the custom domain still work, and that raw CloudFront URLs still 403.

## Rotating Grafana / Cloudflare analytics tokens used by Terraform

Tokens that only exist for Terraform (Grafana Cloud access policy, Cloud Provider scrape, Synthetic Monitoring, Cloudflare Zone Analytics Read) live in **gitignored** `terraform.tfvars` or `GRAFANA_*` / related env vars — never in git. To rotate: create the new token in the vendor UI, put it in the same local/CI secret slot, run `terraform plan` (and apply if the provider must refresh), then **revoke the old token**. No resource recreation is required for a pure credential swap unless a provider forces re-auth of a specific resource.

## Related

- Architecture / Cloudflare-only traffic: [`docs/adr/0005-cloudflare-only-origin.md`](docs/adr/0005-cloudflare-only-origin.md)
- Branch protection / CI gates: [`docs/github-branch-protection.md`](docs/github-branch-protection.md)
- IaC policy skips: [`docs/iac-policy.md`](docs/iac-policy.md)
- Browser headers (CSP / Permissions-Policy): [`docs/security-headers.md`](docs/security-headers.md)
- CodeQL SAST: [`docs/codeql.md`](docs/codeql.md)
