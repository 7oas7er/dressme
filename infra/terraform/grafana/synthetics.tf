data "grafana_synthetic_monitoring_probes" "main" {
  provider = grafana.sm
}

locals {
  # Prefer EU probes when present; fall back to any published probe map values.
  preferred_probe_names = [
    "Frankfurt",
    "Paris",
    "London",
    "Amsterdam",
  ]

  selected_probe_ids = [
    for name in local.preferred_probe_names : data.grafana_synthetic_monitoring_probes.main.probes[name]
    if contains(keys(data.grafana_synthetic_monitoring_probes.main.probes), name)
  ]

  available_probe_ids = (
    length(local.selected_probe_ids) > 0
    ? local.selected_probe_ids
    : [values(data.grafana_synthetic_monitoring_probes.main.probes)[0]]
  )

  # Prod: up to 2 EU probes. Stg: 1 probe to keep Free SM volume down.
  prod_synthetic_probes = slice(local.available_probe_ids, 0, min(2, length(local.available_probe_ids)))
  stg_synthetic_probes  = slice(local.available_probe_ids, 0, min(1, length(local.available_probe_ids)))
}

resource "grafana_synthetic_monitoring_check" "prod_site" {
  provider = grafana.sm

  job       = "dressme-prod-site"
  target    = var.prod_site_url
  enabled   = true
  frequency = var.prod_check_frequency_ms
  timeout   = var.check_timeout_ms
  probes    = local.prod_synthetic_probes

  labels = {
    project     = "dressme"
    environment = "prod"
    kind        = "site"
  }

  settings {
    http {
      method             = "GET"
      fail_if_not_ssl    = true
      valid_status_codes = [200]
    }
  }
}

resource "grafana_synthetic_monitoring_check" "stg_site" {
  provider = grafana.sm

  job       = "dressme-stg-site"
  target    = var.stg_site_url
  enabled   = true
  frequency = var.stg_check_frequency_ms
  timeout   = var.check_timeout_ms
  probes    = local.stg_synthetic_probes

  labels = {
    project     = "dressme"
    environment = "stg"
    kind        = "site"
  }

  settings {
    http {
      method             = "GET"
      fail_if_not_ssl    = true
      valid_status_codes = [200]
    }
  }
}

resource "grafana_synthetic_monitoring_check" "prod_health" {
  provider = grafana.sm

  job       = "dressme-prod-health"
  target    = "${var.prod_site_url}/api/health"
  enabled   = true
  frequency = var.prod_check_frequency_ms
  timeout   = var.check_timeout_ms
  probes    = local.prod_synthetic_probes

  labels = {
    project     = "dressme"
    environment = "prod"
    kind        = "api"
  }

  settings {
    http {
      method             = "GET"
      fail_if_not_ssl    = true
      valid_status_codes = [200]
    }
  }
}

resource "grafana_synthetic_monitoring_check" "stg_health" {
  provider = grafana.sm

  job       = "dressme-stg-health"
  target    = "${var.stg_site_url}/api/health"
  enabled   = true
  frequency = var.stg_check_frequency_ms
  timeout   = var.check_timeout_ms
  probes    = local.stg_synthetic_probes

  labels = {
    project     = "dressme"
    environment = "stg"
    kind        = "api"
  }

  settings {
    http {
      method             = "GET"
      fail_if_not_ssl    = true
      valid_status_codes = [200]
    }
  }
}
