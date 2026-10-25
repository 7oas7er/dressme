resource "grafana_folder" "dressme" {
  provider = grafana.stack

  title = "DressMe"
}

locals {
  dressme_dashboard_files = {
    prod = "${path.module}/dashboards/dressme-prod.json"
    stg  = "${path.module}/dashboards/dressme-stg.json"
  }

  dressme_dashboards = {
    for env, path in local.dressme_dashboard_files :
    env => merge(jsondecode(file(path)), { id = null })
  }

  # Inject CF zoneTag + GitHub owner/repo into dashboard textbox variables.
  dressme_dashboards_with_zone = {
    for env, dash in local.dressme_dashboards :
    env => merge(
      dash,
      {
        templating = {
          list = [
            for v in dash.templating.list : (
              v.name == "cf_zone" && var.cloudflare_zone_tag != null ? merge(v, {
                query   = var.cloudflare_zone_tag
                current = { text = var.cloudflare_zone_tag, value = var.cloudflare_zone_tag }
                }) : v.name == "gh_owner" ? merge(v, {
                query   = var.github_owner
                current = { text = var.github_owner, value = var.github_owner }
                }) : v.name == "gh_repo" ? merge(v, {
                query   = var.github_repository
                current = { text = var.github_repository, value = var.github_repository }
              }) : v
            )
          ]
        }
      },
    )
  }
}

resource "grafana_dashboard" "dressme_env" {
  for_each = local.dressme_dashboards_with_zone

  provider = grafana.stack

  folder      = grafana_folder.dressme.uid
  config_json = jsonencode(each.value)
  overwrite   = true
}
