resource "aws_iam_role" "grafana_cloudwatch" {
  name               = local.grafana_cloudwatch_role
  description        = "Grafana Cloud assumes this role to scrape DressMe CloudWatch metrics."
  assume_role_policy = data.aws_iam_policy_document.grafana_cloudwatch_assume_role.json

  tags = {
    Name    = local.grafana_cloudwatch_role
    Project = "dressme"
  }
}

resource "aws_iam_role_policy" "grafana_cloudwatch" {
  name   = local.grafana_cloudwatch_policy
  role   = aws_iam_role.grafana_cloudwatch.id
  policy = data.aws_iam_policy_document.grafana_cloudwatch.json
}

resource "time_sleep" "grafana_iam_propagation" {
  depends_on = [
    aws_iam_role.grafana_cloudwatch,
    aws_iam_role_policy.grafana_cloudwatch,
  ]

  create_duration = "15s"
}
