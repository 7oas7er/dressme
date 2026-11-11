locals {
  name_prefix               = "shared-dressme"
  grafana_cloudwatch_role   = "${local.name_prefix}-grafana-cloudwatch-role"
  grafana_cloudwatch_policy = "${local.name_prefix}-grafana-cloudwatch-policy"
  # Grafana Labs' AWS account that assumes the CloudWatch integration role.
  grafana_labs_aws_account_id = "008923505280"

  # Account must list every region any scrape job may override to.
  scrape_regions = [
    "eu-north-1",
    "us-east-1",
  ]

  # App workloads (Lambda / Bedrock / DynamoDB) run in eu-north-1.
  scrape_regions_app = ["eu-north-1"]

  # CloudFront metrics are published in us-east-1 only.
  scrape_regions_cloudfront = ["us-east-1"]

  # nonsensitive(): presence checks on tokens must not taint boolean outputs/counts.
  # Infinity DS is owned by platform shared-obs; this flag only gates zoneTag wiring.
  enable_cloudflare_edge = nonsensitive(
    var.enable_cloudflare_edge
    && var.cloudflare_zone_tag != null
  )

  enable_github_ci = nonsensitive(
    var.enable_github_ci
    && var.github_access_token != null
  )
}
