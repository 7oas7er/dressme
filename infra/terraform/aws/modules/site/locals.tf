locals {
  # Naming: [environment]-dressme-[purpose]-[resource-type]
  name_prefix = "${var.environment}-dressme"

  site_bucket_name                 = "${local.name_prefix}-site-bucket"
  access_logs_bucket_name          = "${local.name_prefix}-access-logs-bucket"
  high_scores_bucket_name          = "${local.name_prefix}-health-bucket"
  high_scores_object_key           = "health.json"
  score_tickets_prefix             = "tickets/"
  cloudfront_log_delivery_name     = "${local.name_prefix}-cloudfront-access-logs"
  high_scores_function_name        = "${local.name_prefix}-health-function"
  high_scores_log_group_name       = "${local.name_prefix}-health-log-group"
  high_scores_errors_alarm_name    = "${local.name_prefix}-health-errors-alarm"
  high_scores_throttles_alarm_name = "${local.name_prefix}-health-throttles-alarm"
  high_scores_duration_alarm_name  = "${local.name_prefix}-health-duration-alarm"
  bedrock_client_errors_alarm_name = "${local.name_prefix}-bedrock-client-errors-alarm"
  bedrock_invocations_alarm_name   = "${local.name_prefix}-bedrock-invocations-alarm"
  cloudfront_5xx_alarm_name        = "${local.name_prefix}-site-5xx-alarm"
  # Source of truth for aws_lambda_function.high_scores.timeout; Duration alarm at 80%.
  lambda_timeout_seconds             = 90
  lambda_duration_alarm_threshold_ms = floor(local.lambda_timeout_seconds * 1000 * 0.8)
  # CloudFront → Lambda Function URL origin read timeout (seconds). Default 30
  # caused SPA http_504 on Sonnet Suggest while Lambda still finished (~37s).
  # Max without quota increase is 60; this is the binding edge limit for /api/*.
  cloudfront_api_origin_read_timeout = 60
  # Geographic CRIS profile IDs are "{eu|us}.<foundation-model-id>"; strip for FM ARNs.
  bedrock_foundation_model_id = (
    startswith(var.bedrock_model_id, "eu.") ? trimprefix(var.bedrock_model_id, "eu.") :
    startswith(var.bedrock_model_id, "us.") ? trimprefix(var.bedrock_model_id, "us.") :
    var.bedrock_model_id
  )
  bedrock_inference_profile_arn = (
    startswith(var.bedrock_model_id, "arn:")
    ? var.bedrock_model_id
    : "arn:aws:bedrock:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:inference-profile/${var.bedrock_model_id}"
  )
  # Suggest may pin a different model (e.g. Sonnet trial) via suggest_model_id.
  suggest_model_id_effective = trimspace(var.suggest_model_id) != "" ? var.suggest_model_id : var.bedrock_model_id
  suggest_foundation_model_id = (
    startswith(local.suggest_model_id_effective, "eu.") ? trimprefix(local.suggest_model_id_effective, "eu.") :
    startswith(local.suggest_model_id_effective, "us.") ? trimprefix(local.suggest_model_id_effective, "us.") :
    local.suggest_model_id_effective
  )
  suggest_inference_profile_arn = (
    startswith(local.suggest_model_id_effective, "arn:")
    ? local.suggest_model_id_effective
    : "arn:aws:bedrock:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:inference-profile/${local.suggest_model_id_effective}"
  )
  # EU geographic profiles may route InvokeModel to any of these FM regions
  # (plus home). Missing one yields AccessDenied → SPA 502 / analyze_unavailable.
  bedrock_cris_foundation_model_regions = toset(concat(
    [data.aws_region.current.region],
    [
      "eu-central-1",
      "eu-central-2",
      "eu-west-1",
      "eu-west-3",
      "eu-south-1",
      "eu-south-2",
    ],
  ))
  bedrock_invoke_resources = distinct(concat(
    [local.bedrock_inference_profile_arn],
    [
      for region in local.bedrock_cris_foundation_model_regions :
      "arn:aws:bedrock:${region}::foundation-model/${local.bedrock_foundation_model_id}"
    ],
    [local.suggest_inference_profile_arn],
    [
      for region in local.bedrock_cris_foundation_model_regions :
      "arn:aws:bedrock:${region}::foundation-model/${local.suggest_foundation_model_id}"
    ],
  ))
  high_scores_role_name                 = "${local.name_prefix}-health-role"
  high_scores_policy_name               = "${local.name_prefix}-health-policy"
  github_deploy_role_name               = "${local.name_prefix}-github-deploy-role"
  github_deploy_policy_name             = "${local.name_prefix}-github-deploy-policy"
  site_oac_name                         = "${local.name_prefix}-site-oac"
  high_scores_oac_name                  = "${local.name_prefix}-health-oac"
  site_origin_id                        = "${local.name_prefix}-site-origin"
  high_scores_origin_id                 = "${local.name_prefix}-health-origin"
  site_distribution_name                = "${local.name_prefix}-site-distribution"
  origin_verify_function_name           = "${local.name_prefix}-origin-verify-function"
  strip_aws_headers_function_name       = "${local.name_prefix}-strip-aws-headers-function"
  site_response_headers_policy_name     = "${local.name_prefix}-security-headers-policy"
  cache_policy_caching_optimized        = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  cache_policy_caching_disabled         = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  origin_request_all_viewer_except_host = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  items_table_name                      = "${local.name_prefix}-items-table"
  media_bucket_name                     = "${local.name_prefix}-media-bucket"
  # Cold weekly wardrobe copies (inventory + Dynamo dump + media sync); outside live media.
  backup_bucket_name          = "${local.name_prefix}-backup-bucket"
  wardrobe_backup_policy_name = "${local.name_prefix}-wardrobe-backup-policy"
  cognito_user_pool_name                = "${local.name_prefix}-user-pool"
  cognito_client_name                   = "${local.name_prefix}-spa-client"
  # Cognito hosted UI domain prefix must be globally unique in the region.
  cognito_domain_prefix = "7oas7er-dressme-${var.environment}"
  cognito_auth_domain   = "https://${local.cognito_domain_prefix}.auth.${data.aws_region.current.region}.amazoncognito.com"

  # SPA + Cognito Hosted UI + private media via presigned S3 URLs.
  content_security_policy = join("; ", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "img-src 'self' blob: data: https://*.s3.${data.aws_region.current.region}.amazonaws.com https://*.s3.amazonaws.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' ${local.cognito_auth_domain} https://cognito-idp.${data.aws_region.current.region}.amazonaws.com https://*.s3.${data.aws_region.current.region}.amazonaws.com https://*.s3.amazonaws.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' ${local.cognito_auth_domain}",
    "frame-ancestors 'self'",
    "upgrade-insecure-requests",
  ])
  # Camera for wardrobe photo capture (UC-01). Microphone stays denied (no in-app Mic).
  permissions_policy = join(", ", [
    "accelerometer=()",
    "camera=(self)",
    "geolocation=()",
    "gyroscope=()",
    "magnetometer=()",
    "microphone=()",
    "payment=()",
    "usb=()",
    "interest-cohort=()",
  ])
  lambda_function_url_hostname = trimsuffix(replace(aws_lambda_function_url.high_scores.function_url, "https://", ""), "/")
}
