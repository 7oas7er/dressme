locals {
  # Naming: [environment]-dressme-[purpose]-[resource-type]
  name_prefix = "${var.environment}-dressme"

  site_bucket_name                      = "${local.name_prefix}-site-bucket"
  access_logs_bucket_name               = "${local.name_prefix}-access-logs-bucket"
  high_scores_bucket_name               = "${local.name_prefix}-health-bucket"
  high_scores_object_key                = "health.json"
  score_tickets_prefix                  = "tickets/"
  cloudfront_log_delivery_name          = "${local.name_prefix}-cloudfront-access-logs"
  high_scores_function_name             = "${local.name_prefix}-health-function"
  high_scores_log_group_name            = "${local.name_prefix}-health-log-group"
  high_scores_errors_alarm_name         = "${local.name_prefix}-health-errors-alarm"
  high_scores_throttles_alarm_name      = "${local.name_prefix}-health-throttles-alarm"
  cloudfront_5xx_alarm_name             = "${local.name_prefix}-site-5xx-alarm"
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
  # Same-origin vanilla game: no CDNs, no inline scripts (theme boot is an external file).
  # connect-src 'self' covers same-origin /api/health. Web Audio needs no extra sources.
  content_security_policy = join("; ", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "upgrade-insecure-requests",
  ])
  # Game does not use camera/mic/geo/payment; keep Permissions-Policy tight.
  permissions_policy = join(", ", [
    "accelerometer=()",
    "camera=()",
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
