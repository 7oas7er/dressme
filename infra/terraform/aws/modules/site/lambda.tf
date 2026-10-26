locals {
  high_scores_lambda_dir = "${path.module}/../../../../lambda"
}

check "high_scores_sdk_vendored" {
  assert {
    condition     = fileexists("${local.high_scores_lambda_dir}/node_modules/@aws-sdk/client-s3/package.json")
    error_message = "Missing vendored Lambda deps. Run: cd infra/lambda && npm ci --omit=dev"
  }
}

data "archive_file" "high_scores" {
  type        = "zip"
  source_dir  = local.high_scores_lambda_dir
  output_path = "${path.module}/build/api.zip"
  excludes = [
    "health.test.js",
    "items.test.js",
    "package.json",
    "package-lock.json",
    "README.md",
  ]
}

# HMAC key for single-use play tickets. Kept in Lambda env (not S3) so GET
# /api/health never depends on creating a missing object (S3 returns
# AccessDenied for absent keys when the role lacks s3:ListBucket).
resource "random_password" "score_ticket_secret" {
  length  = 48
  special = false
}

resource "aws_lambda_function" "high_scores" {
  function_name    = local.high_scores_function_name
  description      = "DressMe API (/api/health, /api/config, /api/items)."
  role             = aws_iam_role.high_scores.arn
  handler          = "api.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  filename         = data.archive_file.high_scores.output_path
  source_code_hash = data.archive_file.high_scores.output_base64sha256
  timeout          = 20
  memory_size      = 256

  environment {
    variables = {
      SCORES_BUCKET        = aws_s3_bucket.high_scores.bucket
      SCORES_KEY           = local.high_scores_object_key
      TICKET_SECRET        = random_password.score_ticket_secret.result
      TICKETS_PREFIX       = local.score_tickets_prefix
      ITEMS_TABLE          = aws_dynamodb_table.items.name
      MEDIA_BUCKET         = aws_s3_bucket.media.bucket
      COGNITO_USER_POOL_ID = aws_cognito_user_pool.app.id
      COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.spa.id
      COGNITO_REGION       = data.aws_region.current.region
      COGNITO_AUTH_DOMAIN  = local.cognito_auth_domain
      COGNITO_REDIRECT_URI = "https://${var.site_domain_name}/"
      COGNITO_LOGOUT_URL   = "https://${var.site_domain_name}/"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.high_scores,
    aws_iam_role_policy.high_scores,
    aws_iam_role_policy_attachment.high_scores_basic,
  ]

  tags = {
    Name = local.high_scores_function_name
  }
}

resource "aws_lambda_function_url" "high_scores" {
  function_name      = aws_lambda_function.high_scores.function_name
  authorization_type = "AWS_IAM"
}

resource "aws_lambda_permission" "high_scores_invoke_url_from_cloudfront" {
  statement_id           = "AllowCloudFrontInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.high_scores.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.site.arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "high_scores_invoke_from_cloudfront" {
  statement_id             = "AllowCloudFrontInvokeFunction"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.high_scores.function_name
  principal                = "cloudfront.amazonaws.com"
  source_arn               = aws_cloudfront_distribution.site.arn
  invoked_via_function_url = true
}
