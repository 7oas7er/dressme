output "github_deploy_role_arn" {
  description = "IAM role assumed by GitHub Actions to publish this environment."
  value       = aws_iam_role.github_deploy.arn
}

output "site_url" {
  description = "HTTPS URL for this environment."
  value       = "https://${var.site_domain_name}"
}

output "bucket_name" {
  description = "Private bucket that stores the site files."
  value       = aws_s3_bucket.site.bucket
}

output "access_logs_bucket_name" {
  description = "Private bucket for CloudFront (v2) and S3 site access logs."
  value       = aws_s3_bucket.access_logs.bucket
}

output "high_score_bucket_name" {
  description = "Private bucket that stores the scaffold data bucket (health stub; Option A will add DynamoDB/media)."
  value       = aws_s3_bucket.high_scores.bucket
}

output "distribution_id" {
  description = "CloudFront distribution id."
  value       = aws_cloudfront_distribution.site.id
}

output "distribution_domain_name" {
  description = "CloudFront domain name, used by the Cloudflare CNAME."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "high_score_function_name" {
  description = "Lambda function that serves /api/health (scaffold)."
  value       = aws_lambda_function.high_scores.function_name
}

output "high_score_function_url" {
  description = "Function URL origin behind CloudFront."
  value       = aws_lambda_function_url.high_scores.function_url
}

output "items_table_name" {
  description = "DynamoDB table for wardrobe item metadata."
  value       = aws_dynamodb_table.items.name
}

output "media_bucket_name" {
  description = "Private S3 bucket for wardrobe photos."
  value       = aws_s3_bucket.media.bucket
}

output "cognito_user_pool_id" {
  description = "Cognito user pool id for the SPA auth gate."
  value       = aws_cognito_user_pool.app.id
}

output "cognito_client_id" {
  description = "Cognito SPA app client id (public)."
  value       = aws_cognito_user_pool_client.spa.id
}

output "cognito_auth_domain" {
  description = "Cognito Hosted UI base URL."
  value       = local.cognito_auth_domain
}

output "cognito_owner_temporary_password" {
  description = "Temporary password for cognito_owner_email (only when that variable is set). Change on first Hosted UI sign-in."
  value       = try(random_password.cognito_owner_temp[0].result, null)
  sensitive   = true
}
