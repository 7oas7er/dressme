# Cloudflare — DressMe (DNS only)

Manages DNS for `dressme.7oas7er.com` and `dressme-stg.7oas7er.com` on zone `7oas7er.com`.

Does **not** manage zone apex or `www` (shared zone; other apps own those).

**Zone rulesets** (origin-verify, cache, redirects, API rate limit, SSL mode) are owned by the platform repo:

https://github.com/7oas7er/platform → `infra/terraform/shared-edge`

Extend `shared-edge` for DressMe hosts **before** enabling the CloudFront origin-verify gate. Do not recreate competing zone rulesets here.

```bash
export AWS_PROFILE=7oas7er
export CLOUDFLARE_API_TOKEN=…   # Zone.DNS Edit + Zone.Read (+ Cache Purge for deploy)
cd infra/terraform/cloudflare
terraform init && terraform apply
```
