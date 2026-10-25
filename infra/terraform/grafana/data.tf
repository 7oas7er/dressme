data "grafana_cloud_stack" "dressme" {
  provider = grafana.cloud
  slug     = var.stack_slug
}

data "aws_iam_policy_document" "grafana_cloudwatch_assume_role" {
  statement {
    sid     = "AllowGrafanaCloudAssumeRole"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${local.grafana_labs_aws_account_id}:root"]
    }

    condition {
      test     = "StringEquals"
      variable = "sts:ExternalId"
      # Prefer UI "Add account" External ID when set; otherwise prometheus_user_id.
      values = [
        coalesce(
          var.grafana_aws_external_id,
          tostring(data.grafana_cloud_stack.dressme.prometheus_user_id),
        )
      ]
    }
  }
}

data "aws_iam_policy_document" "grafana_cloudwatch" {
  statement {
    sid    = "AllowCloudWatchMetricScrape"
    effect = "Allow"
    actions = [
      "tag:GetResources",
      "cloudwatch:GetMetricData",
      "cloudwatch:ListMetrics",
      "apigateway:GET",
      "aps:ListWorkspaces",
      "autoscaling:DescribeAutoScalingGroups",
      "dms:DescribeReplicationInstances",
      "dms:DescribeReplicationTasks",
      "ec2:DescribeTransitGatewayAttachments",
      "ec2:DescribeSpotFleetRequests",
      "shield:ListProtections",
      "storagegateway:ListGateways",
      "storagegateway:ListTagsForResource",
    ]
    resources = ["*"]
  }
}
