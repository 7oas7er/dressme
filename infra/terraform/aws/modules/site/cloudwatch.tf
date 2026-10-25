# Manage the Lambda log group explicitly so retention is not "never expire".
# CloudFront distribution metrics live in us-east-1; Lambda metrics stay in the env region.

resource "aws_cloudwatch_log_group" "high_scores" {
  name              = "/aws/lambda/${local.high_scores_function_name}"
  retention_in_days = var.lambda_log_retention_days

  tags = {
    Name = local.high_scores_log_group_name
  }
}

resource "aws_cloudwatch_metric_alarm" "high_scores_errors" {
  alarm_name          = local.high_scores_errors_alarm_name
  alarm_description   = "High-scores Lambda reported Errors > 0."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  threshold           = 1
  treat_missing_data  = "notBreaching"

  metric_name = "Errors"
  namespace   = "AWS/Lambda"
  period      = 60
  statistic   = "Sum"

  dimensions = {
    FunctionName = aws_lambda_function.high_scores.function_name
  }

  tags = {
    Name = local.high_scores_errors_alarm_name
  }
}

resource "aws_cloudwatch_metric_alarm" "high_scores_throttles" {
  alarm_name          = local.high_scores_throttles_alarm_name
  alarm_description   = "High-scores Lambda reported Throttles > 0."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  threshold           = 1
  treat_missing_data  = "notBreaching"

  metric_name = "Throttles"
  namespace   = "AWS/Lambda"
  period      = 60
  statistic   = "Sum"

  dimensions = {
    FunctionName = aws_lambda_function.high_scores.function_name
  }

  tags = {
    Name = local.high_scores_throttles_alarm_name
  }
}

resource "aws_cloudwatch_metric_alarm" "cloudfront_5xx" {
  # CloudFront standard metrics are published only in us-east-1.
  region = "us-east-1"

  alarm_name          = local.cloudfront_5xx_alarm_name
  alarm_description   = "CloudFront 5xx error rate exceeded threshold."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 5
  treat_missing_data  = "notBreaching"

  metric_name = "5xxErrorRate"
  namespace   = "AWS/CloudFront"
  period      = 60
  statistic   = "Average"
  unit        = "Percent"

  dimensions = {
    DistributionId = aws_cloudfront_distribution.site.id
    Region         = "Global"
  }

  tags = {
    Name = local.cloudfront_5xx_alarm_name
  }
}
