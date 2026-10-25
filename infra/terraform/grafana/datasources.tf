# Infinity DS uid infinity-cloudflare is owned by https://github.com/7oas7er/platform
# (shared-obs). Do not recreate it here (409 Conflict on shared stack).

# GitHub Actions / repo queries. Plugin install is owned by platform shared-obs.
resource "grafana_data_source" "github" {
  count    = local.enable_github_ci ? 1 : 0
  provider = grafana.stack

  type = "grafana-github-datasource"
  name = "GitHub DressMe"
  uid  = "github-dressme"

  json_data_encoded = jsonencode({
    selectedAuthType = "personal-access-token"
  })

  secure_json_data_encoded = jsonencode({
    accessToken = var.github_access_token
  })
}
