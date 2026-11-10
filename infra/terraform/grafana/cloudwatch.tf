# Requires org RCP to allow Grafana Labs account 008923505280 to
# sts:AssumeRole on shared-dressme-grafana-cloudwatch-role (see README).
#
# Phase 2 GMD trim: account keeps both scrape regions; jobs use
# regions_subset_override so Lambda/Bedrock/DynamoDB scrape eu-north-1 only
# and CloudFront scrapes us-east-1 only (CF metrics are us-east-1).
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
  regions_subset_override = local.scrape_regions_app

  service {
    name                    = "AWS/Lambda"
    scrape_interval_seconds = 900

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
      statistics = ["Average"]
    }

    tags_to_add_to_metrics = ["Name"]
  }

  # UC-25 Analyze (Converse). Account/region + ModelId dimensions — not env-tagged.
  # Still scraped so token/invocation panels are not dark (gap P0).
  service {
    name                    = "AWS/Bedrock"
    scrape_interval_seconds = 900

    metric {
      name       = "Invocations"
      statistics = ["Sum"]
    }

    metric {
      name       = "InputTokenCount"
      statistics = ["Sum"]
    }

    metric {
      name       = "OutputTokenCount"
      statistics = ["Sum"]
    }
  }

  service {
    name                    = "AWS/DynamoDB"
    scrape_interval_seconds = 900

    metric {
      name       = "ConsumedReadCapacityUnits"
      statistics = ["Sum"]
    }

    metric {
      name       = "ConsumedWriteCapacityUnits"
      statistics = ["Sum"]
    }

    metric {
      name       = "ThrottledRequests"
      statistics = ["Sum"]
    }

    tags_to_add_to_metrics = ["Name"]
  }

  static_labels = {
    project = "dressme"
  }
}

# CloudFront distribution metrics are published in us-east-1 only.
resource "grafana_cloud_provider_aws_cloudwatch_scrape_job" "dressme_cloudfront" {
  count    = var.enable_cloudwatch_scrape ? 1 : 0
  provider = grafana.cloud_provider

  stack_id                = data.grafana_cloud_stack.dressme.id
  name                    = "dressme-cloudwatch-cloudfront"
  aws_account_resource_id = grafana_cloud_provider_aws_account.dressme[0].resource_id
  enabled                 = true
  export_tags             = true
  regions_subset_override = local.scrape_regions_cloudfront

  service {
    name                    = "AWS/CloudFront"
    scrape_interval_seconds = 900

    metric {
      name       = "Requests"
      statistics = ["Sum"]
    }

    metric {
      name       = "5xxErrorRate"
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
