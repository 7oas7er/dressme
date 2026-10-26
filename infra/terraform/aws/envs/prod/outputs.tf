output "github_deploy_role_arn" {
  description = "Store this in the GitHub Environment variable AWS_DEPLOY_ROLE_ARN on environment production."
  value       = module.site.github_deploy_role_arn
}

output "deploy_region" {
  description = "Store this in the GitHub Environment variable AWS_REGION on environment production."
  value       = var.aws_region
}

output "site_url" {
  description = "HTTPS URL for production."
  value       = module.site.site_url
}

output "bucket_name" {
  description = "Store this in the GitHub Environment variable AWS_SITE_BUCKET on environment production."
  value       = module.site.bucket_name
}

output "access_logs_bucket_name" {
  description = "Private bucket for production CloudFront and S3 site access logs."
  value       = module.site.access_logs_bucket_name
}

output "high_score_bucket_name" {
  description = "Private bucket that stores the production scaffold data bucket (health stub; Option A will add DynamoDB/media)."
  value       = module.site.high_score_bucket_name
}

output "distribution_id" {
  description = "Store this in the GitHub Environment variable AWS_DISTRIBUTION_ID on environment production."
  value       = module.site.distribution_id
}

output "distribution_domain_name" {
  description = "CloudFront domain name for the Cloudflare production CNAME."
  value       = module.site.distribution_domain_name
}

output "high_score_function_name" {
  description = "Lambda function that serves /api/health in production."
  value       = module.site.high_score_function_name
}

output "high_score_function_url" {
  description = "Function URL origin behind production CloudFront."
  value       = module.site.high_score_function_url
}

output "items_table_name" {
  description = "Production DynamoDB wardrobe items table."
  value       = module.site.items_table_name
}

output "media_bucket_name" {
  description = "Production private media bucket for wardrobe photos."
  value       = module.site.media_bucket_name
}

output "cognito_user_pool_id" {
  description = "Production Cognito user pool id."
  value       = module.site.cognito_user_pool_id
}

output "cognito_client_id" {
  description = "Production Cognito SPA client id."
  value       = module.site.cognito_client_id
}

output "cognito_auth_domain" {
  description = "Production Cognito Hosted UI base URL."
  value       = module.site.cognito_auth_domain
}
