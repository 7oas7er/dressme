# Requires org RCP to allow Grafana Labs account 008923505280 to
# sts:AssumeRole on shared-dressme-grafana-cloudwatch-role (see README).
resource "grafana_cloud_provider_aws_account" "dressme" {
  count    = var.enable_cloudwatch_scrape ? 1 : 0
  provider = grafana.cloud_provider

  depends_on = [
    time_sleep.grafana_iam_propagation,
    aws_iam_role.grafana_cloudwatch,
  ]

  stack_id = data.grafana_cloud_stack.dressme.id
  role_arn = aws_iam_role.grafana_cloudwatch.arn
  name     = "dressme"
  regions  = local.scrape_regions
}

resource "grafana_cloud_provider_aws_cloudwatch_scrape_job" "dressme" {
  count    = var.enable_cloudwatch_scrape ? 1 : 0
  provider = grafana.cloud_provider

  stack_id                = data.grafana_cloud_stack.dressme.id
  name                    = "dressme-cloudwatch"
  aws_account_resource_id = grafana_cloud_provider_aws_account.dressme[0].resource_id
  enabled                 = true
  export_tags             = true

  service {
    name                    = "AWS/Lambda"
    scrape_interval_seconds = 300

    metric {
      name       = "Invocations"
      statistics = ["Sum"]
    }

    metric {
      name       = "Errors"
      statistics = ["Sum"]
    }

    metric {
      name       = "Throttles"
      statistics = ["Sum"]
    }

    metric {
      name       = "Duration"
      statistics = ["Average", "Maximum"]
    }

    tags_to_add_to_metrics = ["Name"]
  }

  service {
    name                    = "AWS/CloudFront"
    scrape_interval_seconds = 300

    metric {
      name       = "Requests"
      statistics = ["Sum"]
    }

    metric {
      name       = "BytesDownloaded"
      statistics = ["Sum"]
    }

    metric {
      name       = "4xxErrorRate"
      statistics = ["Average"]
    }

    metric {
      name       = "5xxErrorRate"
      statistics = ["Average"]
    }

    metric {
      name       = "TotalErrorRate"
      statistics = ["Average"]
    }

    metric {
      name       = "OriginLatency"
      statistics = ["Average"]
    }

    tags_to_add_to_metrics = ["Name"]
  }

  static_labels = {
    project = "dressme"
  }
}
