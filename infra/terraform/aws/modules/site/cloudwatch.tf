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

# Approach ~80% of the 90s API timeout (thumbs + Bedrock multimodal). No SNS yet.
resource "aws_cloudwatch_metric_alarm" "high_scores_duration" {
  alarm_name          = local.high_scores_duration_alarm_name
  alarm_description   = "API Lambda Duration Maximum approached ${local.lambda_duration_alarm_threshold_ms} ms (~80% of ${local.lambda_timeout_seconds}s timeout)."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  threshold           = local.lambda_duration_alarm_threshold_ms
  treat_missing_data  = "notBreaching"

  metric_name = "Duration"
  namespace   = "AWS/Lambda"
  period      = 60
  statistic   = "Maximum"

  dimensions = {
    FunctionName = aws_lambda_function.high_scores.function_name
  }

  tags = {
    Name = local.high_scores_duration_alarm_name
  }
}

# Cheap signal for IAM/model/access regressions on Analyze (no SNS — BD parity).
resource "aws_cloudwatch_metric_alarm" "bedrock_invocation_client_errors" {
  alarm_name          = local.bedrock_client_errors_alarm_name
  alarm_description   = "Bedrock InvocationClientErrors >= 1 (model/IAM/access regressions)."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 1
  treat_missing_data  = "notBreaching"

  metric_name = "InvocationClientErrors"
  namespace   = "AWS/Bedrock"
  period      = 300
  statistic   = "Sum"

  dimensions = {
    ModelId = var.bedrock_model_id
  }

  tags = {
    Name = local.bedrock_client_errors_alarm_name
  }
}

# Soft solo-use cost signal: many Analyze/suggest calls in a short window.
resource "aws_cloudwatch_metric_alarm" "bedrock_invocations" {
  alarm_name          = local.bedrock_invocations_alarm_name
  alarm_description   = "Bedrock Invocations Sum >= 50 in 1h (soft cost guard for solo v1)."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 50
  treat_missing_data  = "notBreaching"

  metric_name = "Invocations"
  namespace   = "AWS/Bedrock"
  period      = 3600
  statistic   = "Sum"

  dimensions = {
    ModelId = var.bedrock_model_id
  }

  tags = {
    Name = local.bedrock_invocations_alarm_name
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
